"""NAV history for the website (called by the local server for GET /api/nav-history?codes=…).

Usage (by serve.ps1):  python data-pipeline/nav_api.py 122639 100119 …
Output (stdout, JSON): { "from": "YYYY-MM-DD", "series": { "<code>": { "dates": [...], "navs": ["90.354600", ...] } },
                         "missing": [codes with no stored history] }
Only daily NAVs from YEARS_BACK years (plus a margin for the E1 lookups) are returned — enough for
1Y / 3Y / 5Y returns and the 3-year monthly risk window. NAVs are exact decimal strings.
The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from nav_history import from_parquet, object_path  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402

MAX_CODES = 80
YEARS_BACK = 5
MARGIN_DAYS = 45   # covers the 10-day NEAREST-PREVIOUS step and month-end lookups at the window start


def main(argv: list[str]) -> int:
    codes = sorted({int(a) for a in argv if a.isdigit()})
    if not codes or len(codes) > MAX_CODES or len(codes) != len(set(argv)):
        print(json.dumps({"error": "bad scheme code list"}))
        return 2
    today = date.today()
    start = date(today.year - YEARS_BACK, today.month, min(today.day, 28)) - timedelta(days=MARGIN_DAYS)
    schemes = {s["schemeCode"]: s for s in read_lists()}
    client = StorageClient(settings.supabase())

    def one(code):
        scheme = schemes.get(code)
        data = client.download(object_path(scheme)) if scheme else None
        if data is None:
            return code, None
        rows = [(d, n) for d, n in from_parquet(data) if d >= start]
        return code, {"dates": [d.isoformat() for d, _ in rows], "navs": [str(n) for _, n in rows]}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(one, codes))
    out = {"from": start.isoformat(), "series": {str(c): s for c, s in results.items() if s},
           "missing": [c for c, s in results.items() if not s]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
