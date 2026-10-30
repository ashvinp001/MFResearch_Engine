"""Benchmark price history for the website (called by the local server for GET /api/benchmark-history?codes=…).

Usage (by serve.ps1):  python data-pipeline/benchmark_api.py [--years=N] OB48 AUB3 …
Output (stdout, JSON): { "from": "YYYY-MM-DD", "series": { "<code>": { "name", "dates": [...], "values": ["34669.85", ...] } },
                         "missing": [codes not stored] }
Daily prices from YEARS_BACK years (plus the lookup margin), exact decimal strings, from the benchmark bucket
(benchmark-data), through verified_cache (a local copy only while it matches the manifest's SHA-256). The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from benchmark_data import MANIFEST_PATH, STORED_CODE_RE, from_parquet  # noqa: E402
from nav_api import years_option  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402
from verified_cache import cached_manifest, prune, verified_bytes  # noqa: E402

MAX_CODES = 80
YEARS_BACK = 5
MARGIN_DAYS = 45


def main(argv: list[str]) -> int:
    years, argv = years_option(argv)   # --years=N as for nav_api (default YEARS_BACK)
    codes = sorted(set(argv))
    if years is None or not codes or len(codes) > MAX_CODES or len(codes) != len(argv) or not all(STORED_CODE_RE.match(c) for c in codes):
        print(json.dumps({"error": "bad benchmark code list"}))
        return 2
    today = date.today()
    start = date(today.year - years, today.month, min(today.day, 28)) - timedelta(days=MARGIN_DAYS)
    connection = settings.supabase(None, "SUPABASE_BENCHMARK_BUCKET")
    client = StorageClient(connection)
    bucket = connection.get("bucket") or "benchmark-data"
    manifest = {e["code"]: e for e in (cached_manifest(client, MANIFEST_PATH, bucket) or {"benchmarks": []})["benchmarks"]}

    def one(code):
        entry = manifest.get(code)
        data = verified_bytes(client, entry["path"], entry.get("sha256"), bucket) if entry else None   # SHA-256 checked
        if data is None:
            return code, None
        rows = [(d, v) for d, v in from_parquet(data) if d >= start]
        return code, {"name": entry.get("name"), "dates": [d.isoformat() for d, _ in rows], "values": [str(v) for _, v in rows]}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(one, codes))
    out = {"from": start.isoformat(), "series": {c: s for c, s in results.items() if s}, "missing": [c for c, s in results.items() if not s]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    prune(bucket)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
