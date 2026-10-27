"""Peer statistics for the website (called by the local server for GET /api/peer-stats?codes=…).

Usage (by serve.ps1):  python data-pipeline/peer_stats_api.py 122639 100119 …
Output (stdout, JSON): { "asOf", "generatedAt", "method", "funds": { "<code>": {...} },
                         "groups": { "<plan|assetClass|category>": {...} }, "missing": [codes without stats] }
Reads stats/peer-stats.json (written by peer_stats.py after each daily update) and returns only the
requested funds and their peer groups. The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from peer_stats import STATS_PATH  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402

MAX_CODES = 80


def main(argv: list[str]) -> int:
    codes = sorted({a for a in argv if a.isdigit()})
    if not codes or len(codes) > MAX_CODES or len(codes) != len(set(argv)):
        print(json.dumps({"error": "bad scheme code list"}))
        return 2
    stats = StorageClient(settings.supabase()).download_json(STATS_PATH)
    if not stats:
        print(json.dumps({"error": f"{STATS_PATH} not found"}))
        return 1
    funds = {c: stats["funds"][c] for c in codes if c in stats["funds"]}
    groups = {f["group"]: stats["groups"][f["group"]] for f in funds.values()}
    out = {k: stats[k] for k in ("schemaVersion", "asOf", "generatedAt", "method")}
    out.update({"funds": funds, "groups": groups, "missing": [int(c) for c in codes if c not in funds]})
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
