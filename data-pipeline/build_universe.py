"""Build / refresh the fund universe from AMFI's official files.

Usage:
    python data-pipeline/build_universe.py                                   # download today's files
    python data-pipeline/build_universe.py --file NAVOpen.txt --master SchemeData.csv   # saved copies

Input:  AMFI daily NAV file (primary) + AMFI Scheme Master (fills blank Plan/Option columns), and the
        previous lists in data/schemes/ (so a scheme that disappears is kept, marked inactive).
Output: data/schemes/{regular,direct,etf}.json — the website's mapping lists (scheme_lists.py) —
        uploaded to Supabase too (schemes/…), with the run's report (reports/universe-latest.json and
        reports/universe/<AMFI date>.json: counts, every excluded code with its reason, warnings).

Guarantees:
  * Scheme Code is the permanent key: schemes are matched by code, never by name.
  * The daily file's printed Plan / Option columns are primary; the Scheme Master only fills a
    column the daily file leaves blank. Every disagreement between the two files is reported.
  * Nothing is written unless the whole run and every list check pass.
  * Re-running with the same files changes nothing (idempotent).
  * Every excluded code is recorded with its reason; nothing is dropped silently.
  * A scheme is active when its latest NAV is within ACTIVE_WINDOW_DAYS of the file's latest
    NAV date; codes missing from today's file are kept as inactive, never deleted.
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from amfi_source import download, parse_nav_file, parse_scheme_master  # noqa: E402
from scheme_lists import LISTS_DIR, ListError, check, read_lists, upload_lists, write_lists  # noqa: E402
from supabase_storage import StorageClient, StorageError  # noqa: E402
from universe_rules import NAME_SPECIAL_RE, Excluded, Included, classify, is_valid_isin, plan_option_from_nav_name  # noqa: E402

ACTIVE_WINDOW_DAYS = 30


def fund_key(row) -> tuple[str, str]:
    """One fund = AMC + scheme name (whitespace and case ignored) — used only for the pass below."""
    return row.amc, re.sub(r"\s+", " ", row.scheme_name).strip().lower()


def _letters(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def resolve(rows, master) -> tuple[list, list, list]:
    """Classify every row, then the second pass (see the module docstring and the comments below).
    Returns (included, excluded, warnings)."""
    verdicts = {row.scheme_code: classify(row, master.get(row.scheme_code)) for row in rows}
    by_code = {row.scheme_code: row for row in rows}
    as_of = max(row.nav_date for row in rows) if rows else None
    live = lambda code: (as_of - by_code[code].nav_date).days <= ACTIVE_WINDOW_DAYS  # noqa: E731

    # Side-pockets and unclaimed-money plans are named unambiguously in the Scheme Master
    # ("Segregated Portfolio 3", "SG 2", "Unclaimed …"): they are never a fund's Growth plan.
    for code, verdict in verdicts.items():
        if isinstance(verdict, Included) and code in master and NAME_SPECIAL_RE.search(master[code].nav_name):
            verdicts[code] = Excluded(f"Scheme Master: {master[code].nav_name!r} (segregated portfolio / unclaimed plan)")

    # A Growth line under an Institutional/Retail-named plan is the fund's main plan only when the
    # fund has no plain Growth line for that plan, and exactly one such variant exists.
    plain = {(fund_key(by_code[c]), v.plan) for c, v in verdicts.items() if isinstance(v, Included)}
    variants = collections.defaultdict(list)
    for code, verdict in verdicts.items():
        if isinstance(verdict, Excluded) and verdict.variant_of:
            variants[(fund_key(by_code[code]), verdict.variant_of.plan)].append(code)
    for key, codes in variants.items():
        if key not in plain and len(codes) == 1:
            verdicts[codes[0]] = verdicts[codes[0]].variant_of

    # Master-filled lines must not duplicate a fund/plan that already has a printed Growth line.
    sources = collections.defaultdict(lambda: collections.defaultdict(list))
    for code, verdict in verdicts.items():
        if isinstance(verdict, Included) and verdict.plan != "ETF":
            sources[(fund_key(by_code[code]), verdict.plan)][verdict.source].append(code)
    warnings = []
    for (key, plan), by_source in sources.items():
        if by_source.get("daily") and by_source.get("master"):
            for code in by_source["master"]:
                verdicts[code] = Excluded(f"duplicate: the fund already has a printed {plan} Growth line")
        printed = [code for code in by_source.get("daily", []) if live(code)]
        if len(printed) > 1:
            # Several LIVE printed Growth lines for one fund and plan. The Scheme Master's fuller
            # wording decides, and the fund always keeps at least one line:
            #   1. lines it words as IDCW / institutional / retail / PF / bonus are dropped;
            #   2. if some remaining lines are explicitly "Regular"/"Direct" there and others name no
            #      plan at all (legacy pre-2013 plans such as "… - Growth", "Plan B"), the legacy
            #      ones are dropped.
            wording = {code: plan_option_from_nav_name(master[code].nav_name, master[code].scheme_name)
                       if code in master else (None, None) for code in printed}
            flagged = [code for code in printed if wording[code][1] in ("IDCW", "special")]
            if flagged and len(flagged) < len(printed):
                for code in flagged:
                    verdicts[code] = Excluded(f"Scheme Master: {master[code].nav_name!r} (the fund has another {plan} Growth line)")
                printed = [code for code in printed if code not in flagged]
            explicit = [code for code in printed if wording[code][0] == plan]
            legacy = [code for code in printed if code in master and wording[code][0] is None]
            if explicit and legacy:
                for code in legacy:
                    verdicts[code] = Excluded(f"legacy plan: Scheme Master names no plan ({master[code].nav_name!r}); "
                                              f"the fund has an explicit {plan} Plan line")
                printed = [code for code in printed if code not in legacy]
            if len(printed) > 1:
                names = "; ".join(f"{code} = {master[code].nav_name!r}" if code in master else str(code) for code in sorted(printed))
                warnings.append(f"{key[1]} ({key[0]}): {len(printed)} live {plan} Growth lines — all kept: {names}")

    # Report every remaining printed line the Scheme Master words differently (kept as printed).
    for code, verdict in verdicts.items():
        if not isinstance(verdict, Included) or verdict.source != "daily" or verdict.plan == "ETF" or code not in master:
            continue
        m_plan, m_option = plan_option_from_nav_name(master[code].nav_name, master[code].scheme_name)
        if (m_plan and m_plan != verdict.plan) or m_option in ("IDCW", "special"):
            warnings.append(f"{code} {by_code[code].scheme_name}: daily file says {verdict.plan} Growth, "
                            f"Scheme Master says {master[code].nav_name!r}")
        daily_name, master_name = _letters(by_code[code].scheme_name), _letters(master[code].nav_name)
        if daily_name not in master_name and _letters(master[code].scheme_name) not in daily_name:
            warnings.append(f"{code}: the two AMFI files name it differently — daily {by_code[code].scheme_name!r}, "
                            f"Scheme Master {master[code].nav_name!r}")

    included, excluded = [], []
    for row in rows:
        verdict = verdicts[row.scheme_code]
        (included if isinstance(verdict, Included) else excluded).append((row, verdict))
    return included, excluded, warnings

def build(text: str, master_text: str | None, previous: list[dict]) -> tuple[list[dict], dict]:
    """-> (schemes for the lists, the run report). Pure: reads nothing else, writes nothing."""
    rows = parse_nav_file(text)
    master = parse_scheme_master(master_text) if master_text else {}
    data_as_of = max(row.nav_date for row in rows)
    included_rows, excluded_rows, warnings = resolve(rows, master)

    schemes = []
    for row, verdict in included_rows:
        isin_growth = row.isin_growth if is_valid_isin(row.isin_growth) else None
        isin_reinvest = row.isin_reinvest if is_valid_isin(row.isin_reinvest) else None
        if row.isin_growth and isin_growth is None:
            warnings.append(f"{row.scheme_code} {row.scheme_name}: ISIN {row.isin_growth} fails the check digit — left blank")
        schemes.append({
            "schemeCode": row.scheme_code, "schemeName": row.scheme_name, "amc": row.amc,
            "assetClass": verdict.asset_class, "category": verdict.category, "plan": verdict.plan,
            "isin": isin_growth, "isinReinvest": isin_reinvest,
            "active": (data_as_of - row.nav_date).days <= ACTIVE_WINDOW_DAYS and row.nav is not None,
        })
    # Codes in the previous lists but absent from today's file: keep, mark inactive.
    present = {s["schemeCode"] for s in schemes}
    carried = [{**s, "active": False} for s in previous if s["schemeCode"] not in present]
    schemes = sorted(schemes + carried, key=lambda s: s["schemeCode"])

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataAsOf": data_as_of.isoformat(), "rowsRead": len(rows), "schemeMasterRows": len(master),
        "inUniverse": len(schemes), "active": sum(s["active"] for s in schemes),
        "carriedInactive": len(carried), "excluded": len(excluded_rows),
        "plansFromSchemeMaster": sum(1 for _, v in included_rows if v.source == "master"),
        "byAssetClassAndPlan": {f"{a} / {p}": n for (a, p), n in sorted(collections.Counter(
            (s["assetClass"], s["plan"]) for s in schemes).items())},
        "excludedByReason": dict(collections.Counter(_reason_group(v.reason) for _, v in excluded_rows).most_common()),
        "warnings": warnings,
        "exclusions": [{"schemeCode": r.scheme_code, "schemeName": r.scheme_name, "reason": v.reason} for r, v in excluded_rows],
    }
    return schemes, report


def _reason_group(reason: str) -> str:
    """Collapse per-row detail (quoted values) so the summary groups like reasons."""
    return reason.split(":")[0] if ":" in reason and not reason.startswith("outside") else reason


def print_summary(report: dict) -> None:
    print(f"AMFI data as of {report['dataAsOf']} | rows read {report['rowsRead']} | Scheme Master rows "
          f"{report['schemeMasterRows']} | in universe {report['inUniverse']} (active {report['active']}, "
          f"kept inactive {report['carriedInactive']}) | excluded {report['excluded']}")
    print("\nIn the universe (asset class / plan):")
    for label, count in report["byAssetClassAndPlan"].items():
        print(f"  {label:32} {count:5}")
    print("\nExcluded, by reason:")
    for reason, count in report["excludedByReason"].items():
        print(f"  {count:6}  {reason}")
    if report["warnings"]:
        print(f"\nFor review ({len(report['warnings'])}) — kept as printed by AMFI's daily file:")
        for line in report["warnings"]:
            print("  " + line)


def refresh_lists(client: StorageClient, text: str, master_text: str | None, verbose: bool = True) -> tuple[list[dict], dict]:
    """Build, check, write data/schemes/ and upload the lists and the run report. Raises on any failure."""
    schemes, report = build(text, master_text, read_lists(LISTS_DIR) if (LISTS_DIR / "regular.json").exists() else [])
    check(schemes)
    if verbose:
        print_summary(report)
    report["listCounts"] = write_lists(report["dataAsOf"], schemes, LISTS_DIR)
    upload_lists(client, LISTS_DIR)
    client.upload_json("reports/universe-latest.json", report)
    client.upload_json(f"reports/universe/{report['dataAsOf']}.json", report)
    return schemes, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, help="saved AMFI daily NAV file (default: download)")
    parser.add_argument("--master", type=Path, help="saved AMFI Scheme Master CSV (default: download)")
    args = parser.parse_args()
    config = settings.load()
    read = lambda path: path.read_text(encoding="utf-8", errors="replace")  # noqa: E731
    text = read(args.file) if args.file else download(settings.get("AMFI_NAV_URL", config))
    master_text = read(args.master) if args.master else download(settings.get("AMFI_SCHEME_MASTER_URL", config))
    try:
        _, report = refresh_lists(StorageClient(settings.supabase(config)), text, master_text)
    except (ListError, StorageError, settings.SettingsError) as error:
        print(f"\nERROR: {error}", file=sys.stderr)
        return 1
    print("\nLists written to data/schemes/ and Supabase (schemes/): " + " | ".join(f"{p} {n}" for p, n in report["listCounts"].items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
