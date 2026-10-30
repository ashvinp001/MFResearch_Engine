"""Fund details from PulseDB (mf/metadata) -> Supabase stats/fund-metadata.json, for the Fund Scorecard.

Usage:
    python data-pipeline/fund_metadata.py             # after the daily update (run_daily.ps1)
    python data-pipeline/fund_metadata.py --dry-run   # fetch and print a summary; nothing written

For every scheme in our AMFI fund lists (Regular, Direct, ETF), requested in batches (mf/metadata with
"scheme_codes", codes as text, at most 20 per request; 6 requests at a time). Kept per scheme code:
  aum         fund_size, ₹ crore (as published by Pulse; a number or null)
  inception   date_of_inception as ISO "YYYY-MM-DD" (Pulse prints "24-Feb-95"), or null
  manager     fund_manager (and sec_fund_manager when given)
  riskometer  riskometer label; exitLoad: exit_load_period_remark
Nothing is estimated: a value Pulse does not give is null. The Pulse key is read from .env and never printed.
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from pulse_source import PulseClient  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402

METADATA_PATH = "stats/fund-metadata.json"
BATCH = 20                 # Pulse accepts at most 20 scheme codes per request
WORKERS = 6
SCHEMA_VERSION = 1
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_inception(text, today: date | None = None) -> str | None:
    """'24-Feb-95' → '1995-02-24'; a two-digit year after this year's is read as 19xx. Anything else → None."""
    if not isinstance(text, str):
        return None
    parts = text.strip().split("-")
    if len(parts) != 3 or not parts[0].isdigit() or parts[1][:3].lower() not in MONTHS or not parts[2].isdigit():
        return None
    day, month, year = int(parts[0]), MONTHS[parts[1][:3].lower()], int(parts[2])
    if year < 100:
        this_year = (today or date.today()).year % 100
        year += 2000 if year <= this_year else 1900
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value else None


def normalise(row: dict) -> dict:
    managers = [m.strip() for m in (row.get("fund_manager"), row.get("sec_fund_manager")) if isinstance(m, str) and m.strip()]
    exit_load = row.get("exit_load") if isinstance(row.get("exit_load"), dict) else {}
    aum = number(row.get("fund_size"))
    return {
        "aum": round(aum, 2) if aum is not None and aum >= 0 else None,
        "inception": parse_inception(row.get("date_of_inception")),
        "manager": ", ".join(managers) or None,
        "riskometer": row.get("riskometer") if isinstance(row.get("riskometer"), str) else None,
        "exitLoad": exit_load.get("exit_load_period_remark") if isinstance(exit_load.get("exit_load_period_remark"), str) else None,
    }


def fetch(pulse: PulseClient, codes: list[int]) -> dict[str, dict]:
    batches = [[str(c) for c in codes[i:i + BATCH]] for i in range(0, len(codes), BATCH)]

    def one(batch):
        data = pulse._authed("mf/metadata", {"scheme_codes": batch}).get("data") or {}
        return {code: normalise(data[code]) for code in batch if isinstance(data.get(code), dict)}

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for part in pool.map(one, batches):
            out.update(part)
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    config = settings.load()
    codes = sorted({s["schemeCode"] for s in read_lists() if s.get("active", True)})
    pulse = PulseClient(settings.get("PULSE_BASE_URL", config), settings.get("PULSE_PARTNER", config), settings.get("PULSE_KEY", config))
    pulse.login()
    funds = fetch(pulse, codes)
    with_aum = sum(1 for f in funds.values() if f["aum"] is not None)
    print(f"fund metadata: {len(funds)} of {len(codes)} schemes returned, {with_aum} with AUM")
    if len(funds) < 0.8 * len(codes):
        print("fund metadata: fewer than 80% of schemes returned — not written (previous file kept)")
        return 1
    out = {"schemaVersion": SCHEMA_VERSION, "source": "PulseDB mf/metadata", "units": {"aum": "INR crore"},
           "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "funds": funds}
    if args.dry_run:
        return 0
    StorageClient(settings.supabase(config)).upload_json(METADATA_PATH, out)
    print(f"fund metadata: written to {METADATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
