"""Benchmarks we build ourselves (MF_Calculation_Engine.md E7.1) and the category rules that use them.

Why: Pulse's multi-index blends do not follow their stated weights (benchmark_data.COMPOSITE_REASON) and Pulse's
gold price (OB26 "Gold-India") has one-day jumps that reverse (+14.9% / −12.9% / +13.7% on 1–3 Jun 2020,
+16.7% on 16-Oct-2023). So:

  SBGOLD          Domestic gold price — the NAV of Nippon India ETF Gold BeES (AMFI, verified like every NAV;
                  the oldest and largest gold ETF). It runs about its expense ratio (~0.8% a year) below the
                  physical price; for a gold fund that is the yardstick an investor can actually buy.
  SBGS            Gold 50% + Silver 50% (SBGOLD and OB202 "Price of Silver"), for gold-and-silver funds.
  SB<pulse code>  A Pulse blend rebuilt from its own component indices with its stated weights, e.g. SBAB124 =
                  NIFTY 50 50% + CRISIL Short Term Bond 50% (every Balanced Advantage fund's benchmark).

Rules (fund_rule), applied on top of Pulse's mapping:
  gold fund (gold ETF, gold FoF)            -> SBGOLD
  gold-and-silver fund                      -> SBGS
  silver fund (silver ETF, silver FoF)      -> OB202 Price of Silver
  FoF Overseas / ETFs investing overseas    -> S&P 500 (OB94); kept when the fund's own index is NASDAQ 100,
                                               S&P 500 or Hang Seng TECH; NASDAQ funds -> OB39, Hang Seng -> OB28;
                                               overseas bond / treasury funds are left as Pulse maps them
  any fund with a Pulse blend (BAF, Multi Asset, Equity Savings, Balanced Hybrid, their FoFs …) -> SB<pulse code>,
                                               when every component is a stored index and the weights add up to 100
  A blend with a component we do not store (e.g. iCOMDEX) or weights that do not add up stays unmapped and is
  listed in the report — never approximated.

Blend series (blend_rows, E7.1): starts at 100 on the first date every component has a price; on each later date
that every component has, value = previous × (1 + Σ wᵢ × rᵢ), rᵢ = component's return since the previous common
date (daily rebalanced). Dates missing for any component are skipped for all of them together.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from benchmark_data import is_composite

SYNTH_RE = re.compile(r"^SB(GOLD|GS|(?:OB|OHB|AB|AHB|AUB)\d+)$")
GOLD_CODE, GOLD_SILVER_CODE, SILVER_CODE = "SBGOLD", "SBGS", "OB202"
SP500, NASDAQ100, HANG_SENG_TECH = "OB94", "OB39", "OB28"
GOLD_PROXY_SCHEME = 140088   # Nippon India ETF Gold BeES (AMFI)
GOLD_NAME = "Domestic Gold Price (Gold BeES NAV)"
SILVER_NAME = "Price of Silver"
GOLD_SILVER_NAME = "Gold 50% + Silver 50%"
HUNDRED = Decimal(100)

# Component name (as Pulse prints it inside a blend) -> (stored code, short label). First match wins.
COMPONENTS = [
    (re.compile(r"^nifty\s*(index\s*)?500(\s+(index|tri))?$", re.I), "OB56", "NIFTY 500"),
    (re.compile(r"^nifty\s*50(\s+index)?$", re.I), "OB48", "NIFTY 50"),
    (re.compile(r"^nifty\s*50\s+arbitrage(\s+index)?$", re.I), "OB49", "NIFTY 50 Arbitrage"),
    (re.compile(r"^nifty\s*mid\s*small\s*cap\s*400(\s+index)?$", re.I), "OB125", "NIFTY MidSmallcap 400"),
    (re.compile(r"^bse\s+india\s+infrastructure(\s+index)?$", re.I), "OB110", "BSE India Infrastructure"),
    (re.compile(r"^nifty\s*200(\s+index)?$", re.I), "OB47", "NIFTY 200"),
    (re.compile(r"^bse\s*200(\s+index)?$", re.I), "OB98", "BSE 200"),
    (re.compile(r"^bse\s*500(\s+index)?$", re.I), "OB102", "BSE 500"),
    (re.compile(r"^crisil\s+composite\s+bond(\s+fund)?(\s+index)?$", re.I), "AUB2", "CRISIL Composite Bond"),
    # CRISIL renamed its Short Term Bond Fund Index to Short Duration Fund Index (stored as AUB1).
    (re.compile(r"^crisil\s+short[\s-]*(term|duration)(\s+(bond|debt))?(\s+fund)?(\s+a?ii)?(\s+index)?$", re.I), "AUB1", "CRISIL Short Term Bond"),
    (re.compile(r"^crisil\s+liquid(\s+fund)?(\s+index)?$", re.I), "AUB3", "CRISIL Liquid"),
    (re.compile(r"^ccil\s+t-?bill(\s+index)?$", re.I), "AUB4", "CCIL T-Bill"),
    (re.compile(r"^ccil\s+all\s+sovereign\s+bonds?(\s+index)?(\s+tri)?$", re.I), "AUB7", "CCIL Sovereign Bond"),
    (re.compile(r"^crisil\s+hybrid\s+35\s*\+\s*65\b.*$", re.I), "AUB11", "CRISIL Hybrid 35+65"),
    (re.compile(r"^nifty\s+commodities(\s+index)?$", re.I), "OB61", "NIFTY Commodities"),
    (re.compile(r"^dow\s+jones$", re.I), "AUB12", "Dow Jones"),
    (re.compile(r"^s&p\s*500(\s+index)?$", re.I), "OB94", "S&P 500"),
    # gold / silver alone ("Domestic Price of Gold", "INR Price of Gold", "Price of Physical Gold", "Gold Price"…)
    (re.compile(r"^(?!.*silver)(domestic\s+|inr\s+)?(prices?\s+of\s+)?(domestic\s+|physical\s+)*gold(\s+prices?)?$", re.I), GOLD_CODE, "Gold"),
    (re.compile(r"^(?!.*gold)(domestic\s+)?(prices?\s+of\s+)?(domestic\s+)?silver(\s+prices?)?$", re.I), SILVER_CODE, "Silver"),
]
# One "name(weight%)" part and the "+" after it; a name may itself contain "+" (CRISIL Hybrid 35+65).
PART_RE = re.compile(r"\s*([^()]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)\s*(\+|$)")


class BlendError(ValueError):
    pass


def component(text: str) -> tuple[str, str] | None:
    """(code, short label) for one component name, or None when we do not store that index."""
    clean = re.sub(r"\s+", " ", text.strip())
    for pattern, code, label in COMPONENTS:
        if pattern.match(clean):
            return code, label
    return None


def parse_blend(name: str) -> list[tuple[str, Decimal, str]]:
    """'NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)' -> [(code, weight %, label)]. Raises BlendError when a
    part is not read exactly, a component is not stored, or the weights do not add up to 100."""
    out, pos = [], 0
    while pos < len(name):
        match = PART_RE.match(name, pos)
        if not match or match.end() == pos:
            raise BlendError(f"cannot read part {name[pos:].strip()!r}")
        pos = match.end()
        found = component(match.group(1))
        if not found:
            raise BlendError(f"component {match.group(1).strip()!r} is not a stored index")
        out.append((found[0], Decimal(match.group(2)), found[1]))
    total = sum(w for _, w, _ in out)
    if total != HUNDRED:
        raise BlendError(f"weights add up to {total}%, not 100%")
    if len({c for c, _, _ in out}) != len(out):
        raise BlendError("the same index appears twice")
    return out


def blend_name(parts: list[tuple[str, Decimal, str]]) -> str:
    return " + ".join(f"{label} {w.normalize():f}%" for _, w, label in parts)


def blend_rows(parts: list[tuple[str, Decimal]], series: dict[str, list[tuple[date, Decimal]]]) -> list[tuple[date, Decimal]]:
    """E7.1 daily-rebalanced blend (see module doc). parts: [(code, weight %)]; series: code -> [(date, price)]."""
    prices = {code: dict(series[code]) for code, _ in parts}
    common = sorted(set.intersection(*(set(p) for p in prices.values())))
    if len(common) < 2:
        return []
    weights = [(code, w / HUNDRED) for code, w in parts]
    value, out = HUNDRED, [(common[0], HUNDRED)]
    for prev, day in zip(common, common[1:]):
        step = sum(w * (prices[code][day] / prices[code][prev] - 1) for code, w in weights)
        value = value * (1 + step)
        out.append((day, value))
    return out


BLEND_SOURCE = "Prosperr — built by MF_Calculation_Engine.md E7.1 from stored PulseDB indices / AMFI NAVs"


def build_series(synthetic: dict, index_rows: dict[str, list], gold_rows: list | None) -> dict[str, list | str]:
    """code -> rows, or the reason it cannot be built. synthetic: mapping["synthetic"]; index_rows: stored index
    prices by code; gold_rows: the gold proxy's NAVs (SBGOLD), or None when not available."""
    series = dict(index_rows)
    if gold_rows:
        series[GOLD_CODE] = gold_rows
    out = {}
    for code, spec in synthetic.items():
        if code == GOLD_CODE:
            out[code] = gold_rows or f"no NAV history for scheme {GOLD_PROXY_SCHEME} (Gold BeES)"
            continue
        parts = [(c, Decimal(w)) for c, w in spec["components"]]
        missing = [c for c, _ in parts if not series.get(c)]
        if missing:
            out[code] = f"component price history not available: {', '.join(missing)}"
            continue
        rows = blend_rows(parts, series)
        out[code] = rows or "components have no common dates"
    return out


# ---------- category rules ----------

GOLD_SILVER_CATEGORIES = {"Gold ETF", "Silver ETF", "FoF Domestic", "Equity ETF", "Other ETFs"}
# Not a gold / silver price fund: mining equities, multi-asset funds ("asset" alone would catch "Mirae Asset").
NOT_METAL_PRICE = re.compile(r"mining|miners?\b|multi[\s-]*asset|asset\s+allocation|equity|world|overseas", re.I)
OVERSEAS_CATEGORIES = {"FoF Overseas", "ETFs investing overseas"}
OVERSEAS_DEBT = re.compile(r"\b(bond|treasury|debt|income)\b", re.I)


# The owner's choice for single funds (scheme-name pattern -> (stored code, reason)); checked before every other rule.
OWNER_BENCHMARKS = [
    # Owner, 29-Oct-2026: BSE Energy TRI wanted, but Pulse has no named code for it — NIFTY Energy (used by the other
    # energy funds) until that code is available. Its own Pulse blend has a component we do not store (BSE Oil & Gas).
    (re.compile(r"^DSP Natural Resources and New Energy Fund\b", re.I), "OB318", "owner's choice: NIFTY Energy (BSE Energy TRI not available)"),
]


def fund_rule(scheme: dict, current: dict | None) -> tuple[str, str] | None:
    """(benchmark code, rule) for a scheme the rules cover, else None (Pulse's mapping stays). current: the fund's
    Pulse mapping entry ({benchmarkCode, benchmarkName}) or None."""
    name, category = scheme.get("schemeName") or "", scheme.get("category") or ""
    for pattern, owner_code, why in OWNER_BENCHMARKS:
        if pattern.search(name):
            return owner_code, why
    if category in GOLD_SILVER_CATEGORIES and not NOT_METAL_PRICE.search(name):
        gold, silver = re.search(r"\bgold\b", name, re.I), re.search(r"\bsilver\b", name, re.I)
        if gold and silver:
            return GOLD_SILVER_CODE, "gold-and-silver fund"
        if gold:
            return GOLD_CODE, "gold fund"
        if silver:
            return SILVER_CODE, "silver fund"
    code = (current or {}).get("benchmarkCode")
    if category in OVERSEAS_CATEGORIES:
        if OVERSEAS_DEBT.search(name) and not re.search(r"\bequity\b", name, re.I):   # "Equity Income" is equity
            return None
        if re.search(r"hang\s*seng", name, re.I):
            return HANG_SENG_TECH, "overseas fund (own index)"
        if re.search(r"nasdaq", name, re.I):
            return (None if code == NASDAQ100 else (NASDAQ100, "overseas fund (own index)"))
        if code in (SP500, NASDAQ100, HANG_SENG_TECH):
            return None
        return SP500, "overseas fund"
    # Any fund whose benchmark is a Pulse blend (Balanced Advantage, Multi Asset, Equity Savings, Balanced Hybrid, …):
    # the blend is rebuilt from its own components (apply_rules leaves it unmapped when that cannot be done exactly).
    if current and not SYNTH_RE.match(code or "") and is_composite(current.get("benchmarkName")):   # ours already: leave it
        return f"SB{code}", "blend rebuilt from its components"
    return None


# Category standard for a Balanced Advantage / Multi Asset fund whose own blend cannot be built exactly (a component we
# do not store, weights that do not add up): the category's most common official blend, full history from 2016.
CATEGORY_STANDARD = [
    (re.compile(r"multi[\s-]*asset", re.I), "AHB91", "NIFTY 500 Index(65%)+CRISIL Composite Bond Fund Index(20%)+INR Price of Gold(15%)"),
    (re.compile(r"balanced\s+advantage|dynamic\s+asset\s+allocation", re.I), "AB124", "NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)"),
]


def build_fund_blend(scheme: dict, current: dict, code: str, synthetic: dict) -> tuple[str, str, dict] | str:
    """(code, rule, synthetic spec) for a fund with a Pulse blend, or the reason it cannot have one. Tried in order:
    Pulse's final benchmark, the fund's declared benchmark, its alternate benchmark — the first that builds exactly;
    then, for a Balanced Advantage / Multi Asset fund, the category standard (CATEGORY_STANDARD)."""
    reasons = []
    for label, text in (("final", current.get("benchmarkName")), ("declared", current.get("declaredBenchmark")),
                        ("alternate", current.get("alternateBenchmark"))):
        if not text or not is_composite(text):
            continue
        try:
            parts = parse_blend(text)
        except BlendError as error:
            reasons.append(f"{label}: {error}")
            continue
        spec = {"name": blend_name(parts), "components": [[c, str(w)] for c, w, _ in parts]}
        if code in synthetic and synthetic[code]["components"] != spec["components"]:
            reasons.append(f"{label}: differs from the blend already built under {code}")
            continue
        return code, "blend rebuilt from its components" + ("" if label == "final" else f" (its {label} benchmark)"), spec
    text = f"{scheme.get('category') or ''} {scheme.get('schemeName') or ''}"
    for pattern, std_code, std_text in CATEGORY_STANDARD:
        if pattern.search(text):
            parts = parse_blend(std_text)
            return (f"SB{std_code}", "category standard (its own blend cannot be built exactly)",
                    {"name": blend_name(parts), "components": [[c, str(w)] for c, w, _ in parts]})
    return "; ".join(reasons) or "no blend to build"


def apply_rules(mapping: dict, schemes: list[dict], names: dict[str, str]) -> dict:
    """Applies fund_rule to every scheme (ETFs included) in place on mapping["funds"]; sets mapping["synthetic"]
    (code -> {name, components}) and mapping["benchmarks"] (Pulse codes used directly + every component).
    names: stored benchmark names by code (for OB202 / OB94 …). Returns a report."""
    funds = mapping["funds"]
    synthetic, applied, not_built = {}, {}, []
    for scheme in schemes:
        key = str(scheme["schemeCode"])
        current = funds.get(key)
        rule = fund_rule(scheme, current)
        if not rule:
            continue
        code, why = rule
        if code.startswith("SB") and code not in (GOLD_CODE, GOLD_SILVER_CODE):
            built = build_fund_blend(scheme, current, code, synthetic)
            if isinstance(built, str):
                not_built.append({"schemeCode": scheme["schemeCode"], "schemeName": scheme["schemeName"],
                                  "pulseCode": current["benchmarkCode"], "reason": built})
                continue
            code, why, spec = built
            synthetic[code] = spec
        elif code == GOLD_CODE:
            synthetic[code] = {"name": GOLD_NAME, "components": [], "navScheme": GOLD_PROXY_SCHEME}
        elif code == GOLD_SILVER_CODE:
            synthetic[GOLD_CODE] = {"name": GOLD_NAME, "components": [], "navScheme": GOLD_PROXY_SCHEME}
            synthetic[code] = {"name": GOLD_SILVER_NAME, "components": [[GOLD_CODE, "50"], [SILVER_CODE, "50"]]}
        name = synthetic[code]["name"] if code in synthetic else names.get(code) or (current or {}).get("benchmarkName")
        funds[key] = {**(current or {}), "benchmarkCode": code, "benchmarkName": name, "rule": why,
                      **({"pulseCode": current["benchmarkCode"]} if current and current["benchmarkCode"] != code else {}),
                      **({} if current else {"source": "rule"})}
        applied[why] = applied.get(why, 0) + 1
    components = {c for s in synthetic.values() for c, _ in s["components"] if not c.startswith("SB")}
    direct = {e["benchmarkCode"] for e in funds.values() if not SYNTH_RE.match(e["benchmarkCode"])}
    mapping["benchmarks"] = {c: mapping.get("benchmarks", {}).get(c) or names.get(c) for c in sorted(direct | components)}
    mapping["synthetic"] = dict(sorted(synthetic.items()))
    return {"applied": applied, "synthetic": len(synthetic), "notBuilt": not_built}
