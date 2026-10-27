"""The scheme-mapping lists the website reads (Scheme Name, AMC, Category, Code, ISIN).

  read_lists(dir) -> schemes (each with "plan")      the current lists (the universe's memory)
  check(schemes)                                      raises ListError on anything that would make an
                                                      ISIN lookup ambiguous or wrong
  write_lists(as_of, schemes, dir) -> counts          data/schemes/regular.json, direct.json, etf.json
  upload_lists(client, dir)                           the same files to Supabase: schemes/<name>.json

Regular and Direct are kept apart; ETFs are single-class. Logic only — no NAV values. Files are
written to a temporary name and swapped in, one scheme per line (small diffs in git).
"""

from __future__ import annotations

import json
from pathlib import Path

from universe_rules import is_valid_isin

LISTS_DIR = Path(__file__).resolve().parent.parent / "data" / "schemes"
FILES = {"Regular": "regular.json", "Direct": "direct.json", "ETF": "etf.json"}
FIELDS = ("schemeCode", "schemeName", "amc", "assetClass", "category", "isin", "isinReinvest", "active")


class ListError(Exception):
    """The lists failed a check; nothing was written."""


def read_lists(directory: Path = LISTS_DIR) -> list[dict]:
    schemes = []
    for plan, name in FILES.items():
        listing = json.loads((directory / name).read_text(encoding="utf-8"))
        if listing.get("plan") != plan or len(listing["schemes"]) != listing["count"]:
            raise ListError(f"{name} is not a valid {plan} list")
        schemes += [{**s, "plan": plan} for s in listing["schemes"]]
    return schemes


def check(schemes: list[dict]) -> None:
    owner: dict[str, int] = {}
    codes: set[int] = set()
    problems = []
    for scheme in schemes:
        code = scheme["schemeCode"]
        if code in codes:
            problems.append(f"scheme code {code} appears twice")
        codes.add(code)
        if scheme["plan"] not in FILES:
            problems.append(f"{code}: unknown plan {scheme['plan']!r}")
        for isin in (scheme["isin"], scheme["isinReinvest"]):
            if isin is None:
                continue
            if not is_valid_isin(isin):
                problems.append(f"{code}: ISIN {isin} fails the check digit")
            elif owner.setdefault(isin, code) != code:
                problems.append(f"ISIN {isin} belongs to both {owner[isin]} and {code}")
    if problems:
        raise ListError("lists not written:\n  " + "\n  ".join(problems))


def write_lists(as_of: str, schemes: list[dict], directory: Path = LISTS_DIR) -> dict[str, int]:
    check(schemes)
    directory.mkdir(parents=True, exist_ok=True)
    counts = {}
    for plan, name in FILES.items():
        members = [{k: s[k] for k in FIELDS} for s in sorted(schemes, key=lambda s: s["schemeCode"]) if s["plan"] == plan]
        counts[plan] = len(members)
        header = {"source": "AMFI", "dataAsOf": as_of, "plan": plan, "count": len(members)}
        body = ",\n".join("    " + json.dumps(m, ensure_ascii=False, separators=(",", ":")) for m in members)
        text = json.dumps(header, ensure_ascii=False)[:-1] + ',\n  "schemes": [\n' + body + "\n  ]\n}\n"
        json.loads(text)  # never write a file the browser could not parse
        target = directory / name
        temp = target.with_suffix(".json.tmp")
        temp.write_text(text, encoding="utf-8", newline="\n")
        temp.replace(target)
    if sum(counts.values()) != len(schemes):
        raise ListError(f"wrote {sum(counts.values())} schemes but built {len(schemes)}")
    return counts


def upload_lists(client, directory: Path = LISTS_DIR) -> None:
    for name in FILES.values():
        client.upload(f"schemes/{name}", (directory / name).read_bytes(), "application/json")
