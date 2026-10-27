"""NAV history — checking, storage layout and Parquet files (one file per scheme).

  validate_history(scheme, payload, amfi_points, amfi_as_of, today, from_date) -> Checked
      Turns one MFAPI response into checked rows, or rejects it with the reason. Nothing is guessed:
      a row that is not a valid positive NAV is dropped and counted; anything that makes the whole
      series doubtful (other scheme code, other ISIN, conflicting duplicates, future dates, any NAV
      that disagrees with AMFI's own history report on the check dates) rejects the scheme.
      An isolated one-day outlier (a NAV that jumps more than 50% and is back within 5% of the
      previous NAV on the next day) is a publishing error: that day is left out and flagged.
  object_path(scheme) -> "nav/direct/equity/flexi-cap-fund/122639.parquet"
  to_parquet(rows, scheme, fetched_at) -> bytes / from_parquet(bytes) -> rows
      Columns: date (date32), nav (decimal128(24, 6), exact as published). Sorted by date; zstd;
      scheme details in the file's key-value metadata. Built in memory and read back before use.

Bucket layout: nav/<plan>/<asset class>/<category>/<scheme code>.parquet, plus nav/manifest.json
listing every file with its first/last date, row count and SHA-256.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, InvalidOperation

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA_VERSION = 1
HISTORY_FROM = date(2015, 1, 1)
NAV_SCALE = 6                        # decimals stored; MFAPI publishes 5, AMFI up to 6
NAV_TYPE = pa.decimal128(24, NAV_SCALE)
SCHEMA = pa.schema([pa.field("date", pa.date32(), nullable=False), pa.field("nav", NAV_TYPE, nullable=False)])
JUMP_FLAG_RATIO = Decimal("0.30")    # a move above 30% between NAVs ≤ JUMP_WINDOW_DAYS apart is flagged (never changed)
JUMP_WINDOW_DAYS = 7
OUTLIER_RATIO = Decimal("0.50")       # one-day spike size that, if reversed the next day, marks a publishing error
OUTLIER_RETURN_TOLERANCE = Decimal("0.05")
STALE_FLAG_DAYS = 7                  # an active scheme whose latest NAV is older than this is flagged
SOURCE = "mfapi.in (AMFI NAV history)"


@dataclass
class Checked:
    """Outcome for one scheme. rows is empty when rejected or when there is no NAV since HISTORY_FROM."""
    scheme_code: int
    ok: bool
    rows: list[tuple[date, Decimal]] = field(default_factory=list)
    reason: str | None = None              # why it was rejected
    flags: list[str] = field(default_factory=list)  # kept, but worth a look
    verified: int = 0                      # check dates on which MFAPI and AMFI's own report agree


class HistoryRejected(ValueError):
    pass


def validate_history(scheme: dict, payload: dict, amfi_points: dict[date, str], amfi_as_of: date,
                     today: date, from_date: date = HISTORY_FROM) -> Checked:
    """amfi_points: this scheme's NAVs from AMFI's own history report on the check dates
    ({date: NAV as printed}); every one that MFAPI also has must agree."""
    code = scheme["schemeCode"]
    try:
        rows, flags, verified = _check(scheme, payload, amfi_points, amfi_as_of, today, from_date)
    except HistoryRejected as error:
        return Checked(code, ok=False, reason=str(error))
    return Checked(code, ok=True, rows=rows, flags=flags, verified=verified)


def _check(scheme, payload, amfi_points, amfi_as_of, today, from_date):
    code = scheme["schemeCode"]
    flags: list[str] = []
    if payload.get("status") != "SUCCESS" or not isinstance(payload.get("data"), list):
        raise HistoryRejected(f"MFAPI status {payload.get('status')!r} with no data list")
    meta = payload.get("meta") or {}
    if str(meta.get("scheme_code", "")).strip() != str(code):
        raise HistoryRejected(f"MFAPI returned scheme {meta.get('scheme_code')!r}, expected {code}")

    ours = {i for i in (scheme.get("isin"), scheme.get("isinReinvest")) if i}
    theirs = {str(i).strip().upper() for i in (meta.get("isin_growth"), meta.get("isin_div_reinvestment"))
              if i and str(i).strip() not in {"", "-", "None", "null"}}
    if ours and theirs and not ours & theirs:
        raise HistoryRejected(f"ISIN mismatch: our list {sorted(ours)}, MFAPI {sorted(theirs)}")
    if ours and not theirs:
        flags.append("MFAPI prints no ISIN for this scheme (matched by scheme code only)")

    by_date: dict[date, Decimal] = {}
    dropped = duplicates = 0
    for item in payload["data"]:
        day = _parse_date(item.get("date"))
        nav = parse_nav(item.get("nav"))
        if day > today:
            raise HistoryRejected(f"NAV dated in the future: {day.isoformat()}")
        if nav is None:
            dropped += 1
            continue
        if day in by_date:
            if by_date[day] != nav:
                raise HistoryRejected(f"two different NAVs for {day.isoformat()}: {by_date[day]} and {nav}")
            duplicates += 1
            continue
        by_date[day] = nav
    if dropped:
        flags.append(f"{dropped} row(s) without a valid positive NAV (e.g. 0.00000) left out")
    if duplicates:
        flags.append(f"{duplicates} exact duplicate row(s) merged")

    rows = sorted((d, n) for d, n in by_date.items() if d >= from_date)
    rows, outliers = _without_one_day_outliers(rows)
    for (d0, n0), (d1, n1), (d2, _) in outliers:
        flags.append(f"one-day outlier left out: {n1} on {d1.isoformat()} between {n0} ({d0.isoformat()}) and its return on {d2.isoformat()}")
    for (d0, n0), (d1, n1) in zip(rows, rows[1:]):
        if (d1 - d0).days <= JUMP_WINDOW_DAYS and abs(n1 - n0) / n0 > JUMP_FLAG_RATIO:
            flags.append(f"NAV level changed {((n1 - n0) / n0 * 100):+.1f}% from {d0.isoformat()} to {d1.isoformat()} (kept as published)")

    verified = 0
    for amfi_day, amfi_text in sorted(amfi_points.items()):
        amfi_nav = parse_nav(amfi_text)
        if amfi_nav is None or amfi_day not in by_date:
            continue
        ours_nav = by_date[amfi_day]
        if ours_nav != amfi_nav:
            # MFAPI prints 5 decimals; when AMFI prints more, accept only a pure rounding of AMFI's value.
            quantum = Decimal(1).scaleb(ours_nav.as_tuple().exponent)
            roundings = {amfi_nav.quantize(quantum, rounding=mode) for mode in (ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN)}
            if ours_nav not in roundings or -amfi_nav.as_tuple().exponent <= -ours_nav.as_tuple().exponent:
                raise HistoryRejected(f"NAV on {amfi_day.isoformat()}: MFAPI {ours_nav}, AMFI {amfi_text}")
            flags.append(f"MFAPI rounds AMFI's {amfi_text} to {ours_nav} on {amfi_day.isoformat()}")
        verified += 1
    if rows and not verified:
        flags.append("no check date in common with AMFI's history report (not cross-checked)")
    if rows and scheme.get("active") and (amfi_as_of - rows[-1][0]).days > STALE_FLAG_DAYS:
        flags.append(f"latest NAV {rows[-1][0].isoformat()} is {(amfi_as_of - rows[-1][0]).days} days behind AMFI ({amfi_as_of.isoformat()})")
    if not rows:
        flags.append(f"no NAV on or after {from_date.isoformat()}")
    return rows, flags, verified


def _without_one_day_outliers(rows, ratio: Decimal = OUTLIER_RATIO):
    """Drop a NAV that jumps > ratio (default OUTLIER_RATIO) from the previous day and is back within
    OUTLIER_RETURN_TOLERANCE of that previous NAV on the next day (all within JUMP_WINDOW_DAYS).
    A lasting level change (e.g. a face-value change ×100) is never touched."""
    kept, outliers, i = [], [], 0
    while i < len(rows):
        if kept and i + 1 < len(rows):
            (d0, n0), (d1, n1), (d2, n2) = kept[-1], rows[i], rows[i + 1]
            close_in_time = (d1 - d0).days <= JUMP_WINDOW_DAYS and (d2 - d1).days <= JUMP_WINDOW_DAYS
            if close_in_time and abs(n1 - n0) / n0 > ratio and abs(n2 - n0) / n0 <= OUTLIER_RETURN_TOLERANCE:
                outliers.append(((d0, n0), (d1, n1), (d2, n2)))
                i += 1
                continue
        kept.append(rows[i])
        i += 1
    return kept, outliers


def _parse_date(text) -> date:
    try:
        return datetime.strptime(str(text).strip(), "%d-%m-%Y").date()
    except ValueError as error:
        raise HistoryRejected(f"unreadable date {text!r}") from error


def parse_nav(text) -> Decimal | None:
    """A positive NAV with at most NAV_SCALE significant decimals, else None (row left out).
    Trailing zeros carry no value ("14.43500000" = 14.435); real digits beyond NAV_SCALE reject."""
    try:
        nav = Decimal(str(text).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    if not nav.is_finite() or nav <= 0:
        return None
    if -nav.as_tuple().exponent > NAV_SCALE:
        quantum = Decimal(1).scaleb(-NAV_SCALE)
        if nav != nav.quantize(quantum):
            raise HistoryRejected(f"NAV {text!r} has more than {NAV_SCALE} decimals")
        nav = nav.quantize(quantum)
    return nav


def same_nav(stored: Decimal, published: Decimal) -> bool:
    """Equal, or the stored value is a pure rounding of the published one to the published precision
    (AMFI prints some funds with fewer decimals: 22.21 for a stored 22.211000 is the same NAV)."""
    if stored == published:
        return True
    quantum = Decimal(1).scaleb(published.as_tuple().exponent)
    return any(stored.quantize(quantum, rounding=mode) == published for mode in (ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN))


def merge_daily(rows: list[tuple[date, Decimal]], points: dict[date, str], source: str = "AMFI") -> tuple[list[tuple[date, Decimal]], int, int, list[str]]:
    """Daily update: the official source's values for one series ({date: value as printed}) -> (rows, added, corrected, flags).

    The source (AMFI for fund NAVs, Pulse for benchmark prices) is official: dates after the last stored date
    are added; a stored date whose value genuinely differs from the source's (not just fewer printed decimals)
    is corrected to the source's value and flagged. A value that is not positive or has too many decimals is
    left out and flagged."""
    by_date = dict(rows)
    last_date = rows[-1][0] if rows else date.min
    added = corrected = 0
    flags = []
    for day, text in sorted(points.items()):
        try:
            nav = parse_nav(text)
        except HistoryRejected as error:
            flags.append(f"{day.isoformat()}: {error} — left out")
            continue
        if nav is None:
            flags.append(f"{day.isoformat()}: {source} printed {text!r} — left out")
            continue
        if day in by_date:
            if not same_nav(by_date[day], nav):
                flags.append(f"{day.isoformat()}: corrected to {source}'s {text} (was {by_date[day]})")
                by_date[day] = nav
                corrected += 1
            continue
        if day < last_date:
            flags.append(f"{day.isoformat()}: {source} value {text} filled in a missing day")
        by_date[day] = nav
        added += 1
    merged = sorted(by_date.items())
    new_days = {d for d, _ in merged if d > last_date}
    for (d0, n0), (d1, n1) in zip(merged, merged[1:]):
        if d1 in new_days and (d1 - d0).days <= JUMP_WINDOW_DAYS and abs(n1 - n0) / n0 > JUMP_FLAG_RATIO:
            flags.append(f"NAV level changed {((n1 - n0) / n0 * 100):+.1f}% from {d0.isoformat()} to {d1.isoformat()} (kept as published)")
    return merged, added, corrected, flags


def recover_interrupted(data: bytes, last_date: date, last_value: str | None, row_count: int,
                        points: dict[date, str], read=None) -> list[tuple[date, Decimal]] | None:
    """A stored file that no longer matches its manifest entry because an earlier run uploaded it and was then
    stopped before writing the manifest (PC shut down / task killed). Returns its rows when it is exactly such a
    file — else None (the file is left untouched and reported, as before). Accepted only when ALL hold:
      · it reads, dates strictly increasing, at least as many rows as the manifest recorded;
      · it still has the manifest's last date, with the manifest's value (or the official source's value for it);
      · every day after that date is one the official source publishes now, with the same value;
      · every other day the source publishes in this window has the source's value (what merge_daily writes).
    """
    try:
        rows = (read or from_parquet)(data)   # read: the file format's reader (benchmark files have their own)
    except Exception:
        return None
    if len(rows) < row_count or any(a[0] >= b[0] for a, b in zip(rows, rows[1:])):
        return None
    by_date = dict(rows)
    if last_date not in by_date:
        return None

    def official(day):
        try:
            return parse_nav(points[day]) if day in points else None
        except HistoryRejected:
            return None

    kept_last = last_value is not None and same_nav(by_date[last_date], Decimal(last_value))
    if not kept_last and not (official(last_date) is not None and same_nav(by_date[last_date], official(last_date))):
        return None
    for day, value in rows:
        published = official(day)
        if day > last_date and published is None:
            return None   # a newer day the source does not publish: not written by our update
        if published is not None and day != last_date and not same_nav(value, published):
            return None
    return rows


# ---------- layout ----------

def slug(text: str) -> str:
    """'Balanced Advantage / Dynamic Asset Allocation' -> 'balanced-advantage-dynamic-asset-allocation'."""
    value = re.sub(r"[^a-z0-9]+", "-", text.lower().replace("&", " and ")).strip("-")
    if not value:
        raise ValueError(f"cannot build a folder name from {text!r}")
    return value


NAV_PREFIX = "nav"
MANIFEST_PATH = f"{NAV_PREFIX}/manifest.json"


def object_path(scheme: dict) -> str:
    return f"{NAV_PREFIX}/{slug(scheme['plan'])}/{slug(scheme['assetClass'])}/{slug(scheme['category'])}/{scheme['schemeCode']}.parquet"


def check_layout(schemes: list[dict]) -> None:
    """Two different categories must never share a folder, and every path must be unique."""
    folders: dict[str, str] = {}
    paths: set[str] = set()
    for scheme in schemes:
        path = object_path(scheme)
        folder = path.rsplit("/", 1)[0]
        label = f"{scheme['plan']} / {scheme['assetClass']} / {scheme['category']}"
        if folders.setdefault(folder, label) != label:
            raise ValueError(f"folder {folder} would mix '{folders[folder]}' and '{label}'")
        if path in paths:
            raise ValueError(f"two schemes map to {path}")
        paths.add(path)


# ---------- Parquet ----------

def to_parquet(rows: list[tuple[date, Decimal]], scheme: dict, fetched_at: str, source: str = SOURCE) -> bytes:
    """Build the file in memory, read it back and compare. Raises if the round trip differs."""
    quantum = Decimal(1).scaleb(-NAV_SCALE)
    table = pa.table({"date": [d for d, _ in rows], "nav": [n.quantize(quantum) for _, n in rows]}, schema=SCHEMA)
    metadata = {
        "schema_version": str(SCHEMA_VERSION), "scheme_code": str(scheme["schemeCode"]),
        "scheme_name": scheme["schemeName"], "amc": scheme["amc"], "plan": scheme["plan"],
        "asset_class": scheme["assetClass"], "category": scheme["category"],
        "isin": scheme.get("isin") or "", "isin_reinvest": scheme.get("isinReinvest") or "",
        "source": source, "history_from": HISTORY_FROM.isoformat(), "fetched_at": fetched_at,
    }
    table = table.replace_schema_metadata({f"prosperr.{k}": v for k, v in metadata.items()})
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink, compression="zstd", use_dictionary=False, write_statistics=True)
    data = sink.getvalue().to_pybytes()
    if from_parquet(data) != [(d, n.quantize(quantum)) for d, n in rows]:
        raise RuntimeError(f"scheme {scheme['schemeCode']}: Parquet read-back differs from the rows written")
    return data


def from_parquet(data: bytes) -> list[tuple[date, Decimal]]:
    table = pq.read_table(pa.BufferReader(data))
    if table.schema.remove_metadata() != SCHEMA:
        raise ValueError(f"unexpected Parquet columns {table.schema}")
    return list(zip(table.column("date").to_pylist(), table.column("nav").to_pylist()))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
