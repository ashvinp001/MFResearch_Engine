"""Benchmark data — fund→benchmark mapping, price checks, bucket layout and Parquet files.

Bucket: SUPABASE_BENCHMARK_BUCKET (default benchmark-data), separate from the fund data.

Benchmark codes are PulseDB "final benchmark" codes — the series whose prices Pulse publishes:
  OB…  official benchmark index           OHB… official blended (multi-index) benchmark
  AB…  alternate benchmark index          AHB… alternate blended benchmark
  AUB… alternate benchmark series (named after the alternate benchmark it stands for)

resolve_mapping(schemes, live, sheet) -> (mapping, report)
  For every Regular / Direct Growth scheme in our fund lists:
    Pulse live (mf/nav_bm) and the owner's reference sheet (Fund - BM Mapping) agree -> that code, "pulse+sheet"
    both have it but differ -> Pulse's live code ("pulse"; it is current — funds change benchmarks), the sheet's
                               code kept as sheetCode and listed in the report
    only one has it         -> that code, "pulse" or "sheet"
    neither                 -> no benchmark (listed in the report)
  Names: an O… code is named by the fund's declared benchmark, an A… code by its alternate benchmark, as Pulse
  (or the sheet) prints them; a code seen with different names keeps the most used one and is reported.

check_history(code, windows) -> Checked
  Pulse price-history windows -> exact rows: the code must be the one asked for, dates inside the window,
  positive values with ≤ 6 decimals (nav_history.parse_nav), no conflicting duplicates; a day listed without
  a price (null) is left out. A jump > 20% (BREAK_RATIO) that snaps straight back — the next day, or in one
  step within 31 days — is a publishing error and left out; a lasting move > 20% can be real (sector and
  commodity indices) and is kept as published. Everything left out or kept-but-unusual is flagged.

Layout:  prices/<family>/<code>.parquet   (family = ob | ohb | ab | ahb | aub)
         manifest.json · latest.json · mapping/funds.json · reference/fund-bm-mapping-sheet.json · reports/…
Parquet: columns date (date32), value (decimal128(24, 6)); code, name, family and source in the metadata.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

import pyarrow as pa
import pyarrow.parquet as pq

from nav_history import HistoryRejected, _without_one_day_outliers, parse_nav, same_nav

SCHEMA_VERSION = 1
HISTORY_FROM = date(2015, 1, 1)
VALUE_SCALE = 6
SCHEMA = pa.schema([pa.field("date", pa.date32(), nullable=False), pa.field("value", pa.decimal128(24, VALUE_SCALE), nullable=False)])
BREAK_RATIO = Decimal("0.20")   # largest believable move between two index prices (Indian indices: ~13% at worst)
STRETCH_DAYS = 31               # a jump that reverses within this many days is a bad stretch, not a real level
STRETCH_TOLERANCE = Decimal("0.05")
CODE_RE = re.compile(r"^(OB|OHB|AB|AHB|AUB)(\d+)$")
MANIFEST_PATH = "manifest.json"
LATEST_PATH = "latest.json"
MAPPING_PATH = "mapping/funds.json"
REFERENCE_PATH = "reference/fund-bm-mapping-sheet.json"
SOURCE = "PulseDB (mf/bm_price_history, mf/bm_data)"


class BenchmarkError(ValueError):
    pass


COMPOSITE_RE = re.compile(r"\d+(\.\d+)?\s*%")
COMPOSITE_REASON = ("Pulse-made blend of several indices; checked 22-Oct-2026, it does not follow its stated weights "
                    "(e.g. AB124 'NIFTY 50 50% + CRISIL Short Term 50%': 1Y −9.07% vs −3.35% rebuilt from its components) — "
                    "not used until the blend is built from its component indices (MF_Calculation_Engine.md E7)")


def is_composite(name: str | None) -> bool:
    """A benchmark made of several indices with weights in its name, e.g. 'NIFTY 50 Index(50%)+CRISIL Short Term
    Index(50%)'. Official single indices (incl. CRISIL Hybrid 35+65 and NIFTY 50 Hybrid Composite 50:50) do not match."""
    return bool(name) and bool(COMPOSITE_RE.search(name))


def family(code: str) -> str:
    match = CODE_RE.match(code or "")
    if not match:
        raise BenchmarkError(f"not a Pulse benchmark code: {code!r}")
    return match.group(1).lower()


def object_path(code: str) -> str:
    return f"prices/{family(code)}/{code}.parquet"


def name_side(code: str) -> str:
    """Which printed name belongs to a code: 'declared' for O… codes, 'alternate' for A… codes."""
    return "declared" if family(code).startswith("o") else "alternate"


# ---------- mapping ----------

def sheet_reference(sheet_rows: list[dict[str, str]], codes: set[int]) -> dict[int, dict]:
    """The Fund - BM Mapping sheet (columns A–G, header row first), kept for our scheme codes only."""
    header = [sheet_rows[0].get(c, "").strip().upper() for c in "ABCDEFG"] if sheet_rows else []
    expected = ["SCHEME CODE", "SCHEME NAME", "BENCHMARK", "BENCHMARK CODE", "ALTERNATE BENCHMARK", "ALTERNATE BENCHMARK CODE", "FINAL BENCHMARK CODE"]
    if header != expected:
        raise BenchmarkError(f"unexpected sheet columns {header}")
    out = {}
    for r in sheet_rows[1:]:
        text = (r.get("A") or "").strip()
        if not text:
            continue
        code = int(float(text))
        if code in out:
            raise BenchmarkError(f"scheme code {code} appears twice in the sheet")
        if code in codes:
            out[code] = {"schemeName": r.get("B", "").strip(), "declared": r.get("C", "").strip(), "declaredCode": r.get("D", "").strip(),
                         "alternate": r.get("E", "").strip(), "alternateCode": r.get("F", "").strip(), "final": r.get("G", "").strip()}
    return out


def resolve_mapping(schemes: list[dict], live: list[dict], sheet: dict[int, dict]) -> tuple[dict, dict]:
    """schemes: our Regular / Direct Growth list entries; live: mf/nav_bm rows; sheet: sheet_reference()."""
    live_by = {}
    for row in live:
        if str(row.get("scheme_code", "")).isdigit() and CODE_RE.match(row.get("final_benchmark") or ""):
            live_by[int(row["scheme_code"])] = row
    names: dict[str, Counter] = {}

    def seen(code, name):
        if code and name:
            names.setdefault(code, Counter())[name.strip()] += 1

    for row in live_by.values():
        code = row["final_benchmark"]
        seen(code, row.get("benchmark") if name_side(code) == "declared" else row.get("alt_benchmark"))
    for s in sheet.values():
        if CODE_RE.match(s["final"]):
            seen(s["final"], s["declared"] if name_side(s["final"]) == "declared" else s["alternate"])

    funds, differ, sheet_only, pulse_only, none = {}, [], [], [], []
    for scheme in schemes:
        code = scheme["schemeCode"]
        l, s = live_by.get(code), sheet.get(code)
        s_code = s["final"] if s and CODE_RE.match(s["final"]) else None
        if l:
            chosen, source = l["final_benchmark"], "pulse+sheet" if s_code == l["final_benchmark"] else "pulse"
            declared, alternate = (l.get("benchmark") or "").strip(), (l.get("alt_benchmark") or "").strip()
            if s_code and s_code != chosen:
                differ.append({"schemeCode": code, "schemeName": scheme["schemeName"], "plan": scheme["plan"], "pulse": chosen, "sheet": s_code,
                               "pulseDeclared": declared, "sheetDeclared": s["declared"]})
            elif not s_code:
                pulse_only.append(code)
        elif s_code:
            chosen, source, declared, alternate = s_code, "sheet", s["declared"], s["alternate"]
            sheet_only.append(code)
        else:
            none.append({"schemeCode": code, "schemeName": scheme["schemeName"], "plan": scheme["plan"], "category": scheme["category"]})
            continue
        funds[str(code)] = {"benchmarkCode": chosen, "declaredBenchmark": declared or None, "alternateBenchmark": alternate or None,
                            "source": source, **({"sheetCode": s_code} if s_code and s_code != chosen else {})}
    benchmark_names = {code: counter.most_common(1)[0][0] for code, counter in names.items()}
    for entry in funds.values():
        entry["benchmarkName"] = benchmark_names.get(entry["benchmarkCode"])
    used = sorted({e["benchmarkCode"] for e in funds.values()})
    report = {
        "schemes": len(schemes), "mapped": len(funds), "verifiedBySheet": sum(e["source"] == "pulse+sheet" for e in funds.values()),
        "pulseOnly": len(pulse_only), "sheetOnly": sheet_only, "differFromSheet": differ, "noBenchmark": none,
        "benchmarksUsed": len(used),
        "nameConflicts": {c: dict(names[c]) for c in used if c in names and len(names[c]) > 1},
        "unnamed": [c for c in used if not benchmark_names.get(c)],
    }
    return {"funds": funds, "benchmarks": {c: benchmark_names.get(c) for c in used}}, report


# ---------- prices ----------

@dataclass
class Checked:
    code: str
    ok: bool
    rows: list[tuple[date, Decimal]] = field(default_factory=list)
    reason: str | None = None
    flags: list[str] = field(default_factory=list)


def two_year_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Consecutive windows of at most two years (Pulse's daily-history limit), covering start..end exactly."""
    out, current = [], start
    while current <= end:
        try:
            limit = current.replace(year=current.year + 2) - timedelta(days=1)
        except ValueError:  # 29 Feb
            limit = current.replace(year=current.year + 2, day=28)
        out.append((current, min(limit, end)))
        current = out[-1][1] + timedelta(days=1)
    return out


def value_text(value) -> str:
    """A JSON number from Pulse as its shortest exact decimal text (36541.61, not 36541.6099999…)."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise HistoryRejected(f"not a number: {value!r}")
    return repr(value) if isinstance(value, float) else str(value)


def check_history(code: str, windows: list[tuple[tuple[date, date], dict]]) -> Checked:
    """windows: [((start, end), Pulse bm_price_history data)] -> exact, checked rows (see module doc)."""
    result = Checked(code=code, ok=False)
    by_date: dict[date, Decimal] = {}
    left_out, blank = 0, []
    try:
        for (start, end), data in windows:
            if not data:
                continue
            if data.get("final_benchmark") != code:
                raise HistoryRejected(f"Pulse returned code {data.get('final_benchmark')!r} for {code}")
            for day_text, value in (data.get("nav_history") or {}).items():
                try:
                    day = date.fromisoformat(str(day_text)[:10])
                except ValueError as error:
                    raise HistoryRejected(f"unreadable date {day_text!r}") from error
                if not start <= day <= end:
                    raise HistoryRejected(f"{day} is outside the requested window {start}..{end}")
                if value is None:  # Pulse lists the day without a price: no price that day (never filled in)
                    blank.append(day)
                    continue
                parsed = parse_nav(value_text(value))
                if parsed is None:
                    left_out += 1
                    continue
                if day in by_date and by_date[day] != parsed:
                    raise HistoryRejected(f"{day}: two different values ({by_date[day]} and {parsed})")
                by_date[day] = parsed
    except HistoryRejected as error:
        result.reason = str(error)
        return result
    rows = sorted(by_date.items())
    if not rows:
        result.reason = "no prices"
        return result
    # An index never moves > 20% in a day: a spike that reverses is a publishing error (left out) …
    rows, outliers = _without_one_day_outliers(rows, BREAK_RATIO)
    for (d0, n0), (d1, n1), (d2, n2) in outliers:
        result.flags.append(f"one-day spike left out: {d1} {n1} between {d0} {n0} and {d2} {n2}")
    if left_out:
        result.flags.append(f"{left_out} value(s) not positive — left out")
    if blank:
        blank = sorted(set(blank) - set(by_date))
        if blank:
            result.flags.append(f"{len(blank)} day(s) without a price (null) — left out: "
                                + ", ".join(d.isoformat() for d in blank[:5]) + (" …" if len(blank) > 5 else ""))
    # … a jump > 20% that comes back to the level before it within STRETCH_DAYS is a bad stretch of several days
    # (left out) …
    rows, stretches = _without_bad_stretches(rows)
    for (d0, v0), first, last in stretches:
        result.flags.append(f"bad stretch left out: {first} to {last} (moved > {BREAK_RATIO * 100:.0f}% away from {v0} on {d0} and back)")
    # … while a lasting move > 20% can be real (NIFTY PSU Bank +29.6% on 25-Oct-2017, silver −24% on
    # 2-Feb-2026): kept as published, flagged for a look.
    for (d0, v0), (d1, v1) in zip(rows, rows[1:]):
        if _jump(v0, v1):
            result.flags.append(f"large move kept as published: {((v1 - v0) / v0 * 100):+.1f}% from {d0} ({v0}) to {d1} ({v1})")
    result.rows, result.ok = rows, True
    return result


def _jump(v0: Decimal, v1: Decimal) -> bool:
    return abs(v1 - v0) / v0 > BREAK_RATIO


def _without_bad_stretches(rows):
    """Drop rows[i..j-1] when the price jumps > BREAK_RATIO at i and jumps straight back (again > BREAK_RATIO, in
    one step) to within STRETCH_TOLERANCE of the price before the first jump at j, at most STRETCH_DAYS later.
    A real fall recovers gradually, never in one step back to the old level. Returns (rows, [(price before, first, last)])."""
    out, stretches, i = [], [], 0
    while i < len(rows):
        if out and _jump(out[-1][1], rows[i][1]):
            d0, v0 = out[-1]
            back = next((j for j in range(i + 1, len(rows)) if (rows[j][0] - d0).days <= STRETCH_DAYS
                         and abs(rows[j][1] - v0) / v0 <= STRETCH_TOLERANCE and _jump(rows[j - 1][1], rows[j][1])), None)
            if back is not None and all((rows[k][0] - d0).days <= STRETCH_DAYS for k in range(i, back)):
                stretches.append(((d0, v0), rows[i][0], rows[back - 1][0]))
                i = back
                continue
        out.append(rows[i])
        i += 1
    return out, stretches


def compare_on(rows: list[tuple[date, Decimal]], day: date, published: Decimal) -> bool | None:
    """True / False when the history has `day`; None when it does not (no comparison possible). A price list
    printed with fewer decimals (39119 for 39118.86) is the same price (nav_history.same_nav)."""
    stored = dict(rows).get(day)
    return None if stored is None else same_nav(stored, published)


# ---------- Parquet ----------

def to_parquet(rows: list[tuple[date, Decimal]], code: str, name: str | None, fetched_at: str) -> bytes:
    quantum = Decimal(1).scaleb(-VALUE_SCALE)
    table = pa.table({"date": [d for d, _ in rows], "value": [v.quantize(quantum) for _, v in rows]}, schema=SCHEMA)
    metadata = {"schema_version": str(SCHEMA_VERSION), "benchmark_code": code, "benchmark_name": name or "",
                "family": family(code), "source": SOURCE, "history_from": HISTORY_FROM.isoformat(), "fetched_at": fetched_at}
    table = table.replace_schema_metadata({f"prosperr.{k}": v for k, v in metadata.items()})
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink, compression="zstd", use_dictionary=False, write_statistics=True)
    data = sink.getvalue().to_pybytes()
    if from_parquet(data) != [(d, v.quantize(quantum)) for d, v in rows]:
        raise RuntimeError(f"benchmark {code}: Parquet read-back differs from the rows written")
    return data


def from_parquet(data: bytes) -> list[tuple[date, Decimal]]:
    table = pq.read_table(pa.BufferReader(data))
    if table.schema.remove_metadata() != SCHEMA:
        raise ValueError(f"unexpected Parquet columns {table.schema}")
    return list(zip(table.column("date").to_pylist(), table.column("value").to_pylist()))
