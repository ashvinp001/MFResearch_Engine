"""Peer statistics for the website (called by the local server for GET /api/peer-stats?codes=…).

Usage (by the website server, server/routes/api.js):  python data-pipeline/peer_stats_api.py 122639 100119 …
Output (stdout, JSON): { "asOf", "generatedAt", "method", "funds": { "<code>": {...} },
                         "groups": { "<plan|assetClass|category>": {...} }, "missing": [codes without stats],
                         "indexPicks": { "<plan>": { code, name, index, tracking } } }
Reads stats/peer-stats.json (written by peer_stats.py after each daily update) and returns only the
requested funds and their peer groups (the file is reused locally for 5 minutes, verified_cache). The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from peer_stats import STATS_PATH  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402
from verified_cache import cached_manifest  # noqa: E402

MAX_CODES = 80
TRACKING_LIMIT = 1.0   # pp a year, as RECOMMENDATION.passiveTrackingPp


def read_schemes() -> dict:
    return {str(s["schemeCode"]): s for s in read_lists()}


def index_picks(funds: dict, schemes: dict) -> dict:
    """Per plan, the NIFTY 50 index fund with the best average tracking difference (fund − index) over 1, 3 and 5 years."""
    picks: dict = {}
    for code, fund in funds.items():
        bench = fund.get("benchmark") or {}
        scheme = schemes.get(code)
        periods = ("r1y", "r3y", "r5y")
        if not scheme or any((bench.get("fund") or fund).get(k) is None or bench.get(k) is None for k in periods):
            continue
        if "index" not in str(scheme.get("category", "")).lower() or str(bench.get("name", "")).upper() != "NIFTY 50 INDEX":
            continue
        own = bench.get("fund") or fund   # the fund on the index's date when index prices arrive later
        tracking = sum(own[k] - bench[k] for k in periods) / len(periods)
        best = picks.get(scheme["plan"])
        if own["r3y"] - bench["r3y"] >= -TRACKING_LIMIT and (best is None or tracking > best["tracking"]):
            picks[scheme["plan"]] = {"code": int(code), "name": scheme["schemeName"], "index": bench["name"], "tracking": tracking}
    return picks


def main(argv: list[str]) -> int:
    codes = sorted({a for a in argv if a.isdigit()})
    if not codes or len(codes) > MAX_CODES or len(codes) != len(set(argv)):
        print(json.dumps({"error": "bad scheme code list"}))
        return 2
    connection = settings.supabase()
    stats = cached_manifest(StorageClient(connection), STATS_PATH, connection.get("bucket") or "mf-data")   # reused for 5 minutes
    if not stats:
        print(json.dumps({"error": f"{STATS_PATH} not found"}))
        return 1
    funds = {c: stats["funds"][c] for c in codes if c in stats["funds"]}
    groups = {f["group"]: stats["groups"][f["group"]] for f in funds.values()}
    out = {k: stats[k] for k in ("schemaVersion", "asOf", "generatedAt", "method")}
    out.update({"funds": funds, "groups": groups, "missing": [int(c) for c in codes if c not in funds],
                "indexPicks": index_picks(stats["funds"], read_schemes())})
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
