"""Fund details for the website (called by the local server for GET /api/fund-metadata?codes=…).

Usage (by serve.ps1):  python data-pipeline/fund_metadata_api.py 122639 100119 …
Output (stdout, JSON): { "generatedAt", "units", "funds": { "<code>": { aum, inception, manager, riskometer, exitLoad } },
                         "missing": [codes without details] }
Reads stats/fund-metadata.json (written by fund_metadata.py after each daily update; reused locally for 5 minutes).
The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from fund_metadata import METADATA_PATH  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402
from verified_cache import cached_manifest  # noqa: E402

MAX_CODES = 400


def main(argv: list[str]) -> int:
    codes = sorted({a for a in argv if a.isdigit()})
    if not codes or len(codes) > MAX_CODES or len(codes) != len(set(argv)):
        print(json.dumps({"error": "bad scheme code list"}))
        return 2
    connection = settings.supabase()
    stored = cached_manifest(StorageClient(connection), METADATA_PATH, connection.get("bucket") or "mf-data")
    if not stored:
        print(json.dumps({"error": "fund metadata not available"}))
        return 1
    funds = stored.get("funds", {})
    out = {"generatedAt": stored.get("generatedAt"), "units": stored.get("units"),
           "funds": {c: funds[c] for c in codes if c in funds}, "missing": [c for c in codes if c not in funds]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
