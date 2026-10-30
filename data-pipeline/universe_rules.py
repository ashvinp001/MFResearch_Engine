"""Fund-universe rules — which AMFI schemes are in our universe, and how they are labelled.

Input:  one parsed AMFI row (amfi_source.AmfiRow).
Output: classify(row) -> Included(asset_class, category, plan, option) | Excluded(reason).

Universe (owner's decision): open-ended schemes in Equity, Hybrid, Debt, Other (Index funds,
ETFs, FoF, Gold/Silver ETFs) and Solution Oriented (Retirement, Children's); BOTH Regular and
Direct plans; Growth option only; ETFs as single-class. Life Cycle funds, close-ended and
interval schemes are out.

Nothing is guessed:
  * Plan and option come from AMFI's own Plan / Option columns.
  * Category = AMFI's own label. Only labels that are plainly the same category in AMFI's two
    concurrent naming systems are unified (e.g. "Equity Scheme - Large Cap Fund" and
    "Equity Schemes - Large Cap Fund"). Different labels stay different.
  * A section heading that is not in CATEGORY_MAP stops the build (see UnknownSectionError),
    so a new AMFI category can never slip in unlabelled.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

EQUITY, HYBRID, DEBT, OTHER, SOLUTION = "Equity", "Hybrid", "Debt", "Other", "Solution Oriented"
INCLUDED_ASSET_CLASSES = {EQUITY, HYBRID, DEBT, OTHER, SOLUTION}
EXCLUDED_GROUP = "Excluded"

# Normalised AMFI section label -> (asset class, category). Keys are the text inside
# "Open Ended Schemes( … )" after normalise_label(). Both naming systems are listed.
CATEGORY_MAP: dict[str, tuple[str, str]] = {
    # ---- Equity ----
    "Equity Scheme - Large Cap Fund": (EQUITY, "Large Cap Fund"),
    "Equity Schemes - Large Cap Fund": (EQUITY, "Large Cap Fund"),
    "Equity Scheme - Large & Mid Cap Fund": (EQUITY, "Large & Mid Cap Fund"),
    "Equity Schemes - Large & Mid Cap Fund": (EQUITY, "Large & Mid Cap Fund"),
    "Equity Scheme - Mid Cap Fund": (EQUITY, "Mid Cap Fund"),
    "Equity Schemes - Mid Cap Fund": (EQUITY, "Mid Cap Fund"),
    "Equity Scheme - Small Cap Fund": (EQUITY, "Small Cap Fund"),
    "Equity Schemes - Small Cap Fund": (EQUITY, "Small Cap Fund"),
    "Equity Scheme - Flexi Cap Fund": (EQUITY, "Flexi Cap Fund"),
    "Equity Schemes - Flexi Cap Fund": (EQUITY, "Flexi Cap Fund"),
    "Equity Scheme - Multi Cap Fund": (EQUITY, "Multi Cap Fund"),
    "Equity Schemes - Multi Cap Fund": (EQUITY, "Multi Cap Fund"),
    "Equity Scheme - Focused Fund": (EQUITY, "Focused Fund"),
    "Equity Schemes - Focused Fund": (EQUITY, "Focused Fund"),
    "Equity Scheme - Value Fund": (EQUITY, "Value Fund"),
    "Equity Schemes - Value Fund": (EQUITY, "Value Fund"),
    "Equity Scheme - Contra Fund": (EQUITY, "Contra Fund"),
    "Equity Schemes - Contra Fund": (EQUITY, "Contra Fund"),
    "Equity Scheme - Dividend Yield Fund": (EQUITY, "Dividend Yield Fund"),
    "Equity Schemes - Dividend Yield Fund": (EQUITY, "Dividend Yield Fund"),
    "Equity Scheme - ELSS": (EQUITY, "ELSS (Tax Saver)"),
    "Equity Schemes - ELSS- Tax Saver Fund": (EQUITY, "ELSS (Tax Saver)"),
    "Equity Scheme - Sectoral/ Thematic": (EQUITY, "Sectoral/Thematic"),
    "Equity Schemes - Sectoral Fund": (EQUITY, "Sectoral Fund"),
    "Equity Schemes - Thematic Fund": (EQUITY, "Thematic Fund"),
    # ---- Hybrid ----
    "Hybrid Scheme - Aggressive Hybrid Fund": (HYBRID, "Aggressive Hybrid Fund"),
    "Hybrid Schemes - Aggressive Hybrid Fund": (HYBRID, "Aggressive Hybrid Fund"),
    "Hybrid Scheme - Conservative Hybrid Fund": (HYBRID, "Conservative Hybrid Fund"),
    "Hybrid Schemes - Conservative Hybrid Fund": (HYBRID, "Conservative Hybrid Fund"),
    "Hybrid Scheme - Balanced Hybrid Fund": (HYBRID, "Balanced Hybrid Fund"),
    "Hybrid Schemes - Balanced Hybrid Fund": (HYBRID, "Balanced Hybrid Fund"),
    "Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage": (HYBRID, "Balanced Advantage / Dynamic Asset Allocation"),
    "Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation": (HYBRID, "Balanced Advantage / Dynamic Asset Allocation"),
    "Hybrid Scheme - Multi Asset Allocation": (HYBRID, "Multi Asset Allocation"),
    "Hybrid Schemes - Multi Asset Allocation Fund": (HYBRID, "Multi Asset Allocation"),
    "Hybrid Scheme - Arbitrage Fund": (HYBRID, "Arbitrage Fund"),
    "Hybrid Schemes - Arbitrage Fund": (HYBRID, "Arbitrage Fund"),
    "Hybrid Scheme - Equity Savings": (HYBRID, "Equity Savings"),
    "Hybrid Schemes - Equity Savings Fund": (HYBRID, "Equity Savings"),
    # ---- Debt: in both naming systems ----
    "Debt Scheme - Overnight Fund": (DEBT, "Overnight Fund"),
    "Income/Debt Oriented Schemes - Overnight Fund": (DEBT, "Overnight Fund"),
    "Debt Scheme - Liquid Fund": (DEBT, "Liquid Fund"),
    "Income/Debt Oriented Schemes - Liquid Fund": (DEBT, "Liquid Fund"),
    "Debt Scheme - Money Market Fund": (DEBT, "Money Market Fund"),
    "Income/Debt Oriented Schemes - Money Market Fund": (DEBT, "Money Market Fund"),
    "Debt Scheme - Corporate Bond Fund": (DEBT, "Corporate Bond Fund"),
    "Income/Debt Oriented Schemes - Corporate Bond Fund": (DEBT, "Corporate Bond Fund"),
    "Debt Scheme - Credit Risk Fund": (DEBT, "Credit Risk Fund"),
    "Income/Debt Oriented Schemes - Credit Risk Fund": (DEBT, "Credit Risk Fund"),
    "Debt Scheme - Gilt Fund": (DEBT, "Gilt Fund"),
    "Income/Debt Oriented Schemes - Gilt Fund": (DEBT, "Gilt Fund"),
    "Debt Scheme - Banking and PSU Fund": (DEBT, "Banking and PSU Fund"),
    "Income/Debt Oriented Schemes - Banking and PSU Debt Fund": (DEBT, "Banking and PSU Fund"),
    # ---- Debt: older naming only ----
    "Debt Scheme - Ultra Short Duration Fund": (DEBT, "Ultra Short Duration Fund"),
    "Debt Scheme - Low Duration Fund": (DEBT, "Low Duration Fund"),
    "Debt Scheme - Short Duration Fund": (DEBT, "Short Duration Fund"),
    "Debt Scheme - Medium Duration Fund": (DEBT, "Medium Duration Fund"),
    "Debt Scheme - Medium to Long Duration Fund": (DEBT, "Medium to Long Duration Fund"),
    "Debt Scheme - Long Duration Fund": (DEBT, "Long Duration Fund"),
    "Debt Scheme - Dynamic Bond": (DEBT, "Dynamic Bond"),
    # ---- Debt: newer naming only (kept separate — not assumed equal to older categories) ----
    "Income/Debt Oriented Schemes - Ultra Short Term Fund": (DEBT, "Ultra Short Term Fund"),
    "Income/Debt Oriented Schemes - Ultra Short to Short Term Fund": (DEBT, "Ultra Short to Short Term Fund"),
    "Income/Debt Oriented Schemes - Short Term Fund": (DEBT, "Short Term Fund"),
    "Income/Debt Oriented Schemes - Medium Term Fund": (DEBT, "Medium Term Fund"),
    "Income/Debt Oriented Schemes - Medium to Long Term Fund": (DEBT, "Medium to Long Term Fund"),
    "Income/Debt Oriented Schemes - Long Term Fund": (DEBT, "Long Term Fund"),
    "Income/Debt Oriented Schemes - Dynamic Term Fund": (DEBT, "Dynamic Term Fund"),
    "Income/Debt Oriented Schemes - Floating Interest Rates Fund": (DEBT, "Floating Interest Rates Fund"),
    "Income/Debt Oriented Schemes - 10-year Constant Maturity Gilt Fund": (DEBT, "10-year Constant Maturity Gilt Fund"),
    "Income/Debt Oriented Schemes - Sectoral Fund": (DEBT, "Sectoral Fund"),
    # ---- Legacy pre-categorisation headings (no live schemes today) ----
    "Income": (DEBT, "Income (legacy)"),
    "Gilt": (DEBT, "Gilt (legacy)"),
    "Growth": (EQUITY, "Growth (legacy)"),
    # ---- Other: index funds, ETFs, fund of funds ----
    "Other Scheme - Index Funds": (OTHER, "Index Funds"),
    "Index Funds - Equity Funds": (OTHER, "Index Funds - Equity"),
    "Index Funds - Debt Funds": (OTHER, "Index Funds - Debt"),
    "Index Funds - Hybrid Fund": (OTHER, "Index Funds - Hybrid"),
    "Other Scheme - Other ETFs": (OTHER, "Other ETFs"),
    "Other Scheme - Gold ETF": (OTHER, "Gold ETF"),
    "Exchange Traded Funds (ETFs) - Gold ETF": (OTHER, "Gold ETF"),
    "Exchange Traded Funds (ETFs) - Silver ETF": (OTHER, "Silver ETF"),
    "Exchange Traded Funds (ETFs) - Equity ETF": (OTHER, "Equity ETF"),
    "Exchange Traded Funds (ETFs) - Debt ETF": (OTHER, "Debt ETF"),
    "Exchange Traded Funds (ETFs) - Hybrid ETF": (OTHER, "Hybrid ETF"),
    "Exchange Traded Funds (ETFs) - Other ETF": (OTHER, "Other ETF"),
    "Exchange Traded Funds (ETFs) - ETFs investing overseas": (OTHER, "ETFs investing overseas"),
    "Other Scheme - FoF Domestic": (OTHER, "FoF Domestic"),
    "Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)": (OTHER, "FoF Domestic"),
    "Other Scheme - FoF Overseas": (OTHER, "FoF Overseas"),
    "Overseas Fund of Funds - Fund of Funds investing overseas": (OTHER, "FoF Overseas"),
    # ---- Solution oriented ----
    "Solution Oriented Scheme - Retirement Fund": (SOLUTION, "Retirement Fund"),
    "Solution Oriented Schemes ** - Retirement Fund": (SOLUTION, "Retirement Fund"),
    "Solution Oriented Scheme - Children's Fund": (SOLUTION, "Children's Fund"),
    "Children's Fund - Childrens' Fund": (SOLUTION, "Children's Fund"),
    # ---- Known but outside the universe ----
    "Life Cycle Funds - Life Cycle Fund with Maturity of 5 Years": (EXCLUDED_GROUP, "Life Cycle Fund"),
    "Life Cycle Funds - Life Cycle Fund with Maturity of 10 Years": (EXCLUDED_GROUP, "Life Cycle Fund"),
    "Life Cycle Funds - Life Cycle Fund with Maturity of 15 Years": (EXCLUDED_GROUP, "Life Cycle Fund"),
}

ETF_CATEGORIES = {"Other ETFs", "Gold ETF", "Silver ETF", "Equity ETF", "Debt ETF", "Hybrid ETF", "Other ETF", "ETFs investing overseas"}

PLAN_MAP = {"regular plan": "Regular", "direct plan": "Direct"}

# Special-purpose plans that are NOT the normal Growth option, even when the text says "Growth".
# Option text: the full list. Scheme name: only unambiguous markers, so a real fund whose name
# happens to contain a word like "Retail" is never excluded.
OPTION_SPECIAL_RE = re.compile(
    r"unclaimed|investor education|i\.?\s?e\.?\s?f\b|institutional|\bretail\b|discontinued|defunct|"
    r"segregat|\bsg\s*\d|provident|\bp\s?f\b|bonus|monthly payment|defined maturity|redemption|refund|brokerage",
    re.IGNORECASE,
)
# A segregated portfolio (side-pocket) is named "… (Segregated - 06032020)". The MAIN fund may
# mention side-pockets ("No. of segregated portfolios-3", "the scheme has 2 segregated
# portfolios") and must stay in — so only the "(Segregated - <date>)" form is excluded.
# Side-pocket wording: "(Segregated - 06032020)" or "Segregated Portfolio 1" (singular + number).
# Main funds say "Segregated Portfolios - 1" / "No. of segregated portfolios-3" (plural) and stay in.
# "SG 1" / "SG 2" is AMFI's short form for a segregated portfolio.
NAME_SPECIAL_RE = re.compile(
    r"unclaimed|investor education|discontinued|defunct|\(\s*segregated\s*-\s*\d|segregated\s+portfolio\s*-?\s*\d|\bsg\s*\d\b",
    re.IGNORECASE,
)
INCOME_DISTRIBUTION_RE = re.compile(r"idcw|idwc|dividend|payout|reinvest|income distribution|capital withdrawal", re.IGNORECASE)
# Exactly the Growth option, in AMFI's spellings: "Growth", "Growth Option", "GROWTH OPTION",
# "(Growth)", "Cumulative", "Direct Growth" / "Regular Growth" (checked against the Plan column).
GROWTH_RE = re.compile(r"^\(?\s*(?:(direct|regular)\s+)?(?:growth|cumulative)(?:\s+option)*\s*\)?$", re.IGNORECASE)


class UnknownSectionError(ValueError):
    """AMFI printed a section heading we have not mapped — the build stops instead of guessing."""


@dataclass(frozen=True)
class Included:
    asset_class: str
    category: str
    plan: str     # Regular | Direct | ETF
    option: str   # Growth | ETF
    source: str = "daily"   # 'daily' = AMFI daily file columns; 'master' = filled from the Scheme Master;
                            # 'pulse' = AMFI states neither, filled from PulseDB (pulse_plan_fill)


@dataclass(frozen=True)
class Excluded:
    reason: str
    # A Growth line under an Institutional/Retail-named plan. For some funds this IS the main plan
    # (e.g. Franklin India Liquid Fund "Super Institutional"), so the build uses it only when the
    # fund has no plain Growth line for that plan.
    variant_of: "Included | None" = None


def normalise_label(text: str) -> str:
    """Fix non-ASCII apostrophes / mis-decoded characters and collapse whitespace."""
    text = text.replace("’", "'").replace("‘", "'")
    text = re.sub(r"[^\x20-\x7E]+", "'", text)
    text = re.sub(r"'{2,}", "'", text)
    return re.sub(r"\s+", " ", text).strip()


def section_category(section: str) -> tuple[str, str] | None:
    """(asset class, category) for an AMFI section heading; None if it is not open-ended."""
    match = re.match(r"^\s*Open Ended Schemes?\s*\((.*)\)\s*$", section, re.IGNORECASE)
    if not match:
        return None
    label = normalise_label(match.group(1))
    # Life Cycle funds are outside the universe whatever their maturity (AMFI adds new maturities, e.g. 30 Years).
    if re.fullmatch(r"Life Cycle Funds? - Life Cycle Fund with Maturity of \d+ Years?", label, re.IGNORECASE):
        return (EXCLUDED_GROUP, "Life Cycle Fund")
    if label not in CATEGORY_MAP:
        raise UnknownSectionError(f"New AMFI section heading — add it to CATEGORY_MAP: {label!r}")
    return CATEGORY_MAP[label]


# "Super Institutional Growth", "Retail Plan - Growth Option", "Institutional Plan-Growth Option" …
VARIANT_GROWTH_RE = re.compile(r"^(?:super\s+)?(?:institutional|retail)(?:\s+plan)?\s*-?\s*growth(?:\s+option)*$", re.IGNORECASE)


def plan_option_from_nav_name(nav_name: str, scheme_name: str) -> tuple[str | None, str | None]:
    """Plan and option as worded in the Scheme Master's NAV name, read from the text AFTER the
    fund's own name (so "Dividend Yield Fund" is never read as the dividend option).
    Returns (plan, option); option is "Growth", "IDCW", "special" or None; None = not stated."""
    tail = _text_after_fund_name(nav_name.lower(), scheme_name.lower())
    # Side-pocket / unclaimed wording can sit inside the Master's scheme name itself, so the whole
    # NAV name is checked for it; the other plan words are read only from the tail.
    if NAME_SPECIAL_RE.search(nav_name) or OPTION_SPECIAL_RE.search(tail):
        return None, "special"
    direct, regular = bool(re.search(r"\bdirect\b", tail)), bool(re.search(r"\bregular\b", tail))
    plan = "Direct" if direct and not regular else "Regular" if regular and not direct else None
    if INCOME_DISTRIBUTION_RE.search(tail):
        return plan, "IDCW"
    return plan, "Growth" if re.search(r"\bgrowth\b|\bcumulative\b", tail) else None


def _text_after_fund_name(nav: str, name: str) -> str:
    """The plan/option wording of a NAV name. First try the fund name as a prefix, comparing
    letters and digits only (AMFI's punctuation varies: "UTI - Dividend Yield Fund" vs
    "UTI-Dividend Yield Fund.-Growth"); otherwise drop every word that belongs to the fund name."""
    target = re.sub(r"[^a-z0-9]", "", name)
    if target:
        matched = 0
        for position, char in enumerate(nav):
            if not char.isalnum():
                continue
            if char != target[matched]:
                break
            matched += 1
            if matched == len(target):
                return nav[position + 1:]
    name_words = set(re.findall(r"[a-z0-9]+", name))
    return " ".join(word for word in re.findall(r"[a-z0-9]+", nav) if word not in name_words)


def classify(row, master=None) -> Included | Excluded:
    """master: the scheme's MasterRow (AMFI Scheme Master), used ONLY to fill a Plan / Option
    column that the daily file leaves blank — never to override a printed value."""
    mapped = section_category(row.section)
    if mapped is None:
        return Excluded("not an open-ended scheme")
    asset_class, category = mapped
    if asset_class not in INCLUDED_ASSET_CLASSES:
        return Excluded(f"outside the universe: {category}")

    name, plan_text, option_text = row.scheme_name, row.plan.strip(), row.option.strip()
    if NAME_SPECIAL_RE.search(name):
        return Excluded("special-purpose plan (unclaimed, segregated portfolio, discontinued…)")
    if INCOME_DISTRIBUTION_RE.search(option_text):
        return Excluded("IDCW / dividend option")

    if category in ETF_CATEGORIES:
        if OPTION_SPECIAL_RE.search(option_text) or (option_text and not GROWTH_RE.match(option_text)):
            return Excluded(f"ETF with unrecognised option: {option_text!r}")
        return Included(asset_class, category, "ETF", "ETF")

    plan = PLAN_MAP.get(plan_text.lower())
    if plan_text and plan is None:
        return Excluded(f"unrecognised plan: {plan_text!r}")

    # Blank Plan / Option columns: fill from the Scheme Master's wording, when it is unambiguous.
    source = "daily"
    if not plan_text or not option_text:
        source = "master"
        master_plan, master_option = plan_option_from_nav_name(master.nav_name, master.scheme_name) if master else (None, None)
        if master_option == "special":
            return Excluded("special-purpose plan (unclaimed, segregated portfolio, discontinued…)")
        if not option_text:
            if master_option == "IDCW":
                return Excluded("IDCW / dividend option (Scheme Master)")
            if master_option != "Growth":
                return Excluded("option not stated")
            option_text = "Growth"
        if not plan_text:
            stated = GROWTH_RE.match(option_text)
            if stated and stated.group(1):
                plan, source = stated.group(1).capitalize(), "daily" if row.option.strip() else "master"
            else:
                plan = master_plan
            if plan is None:
                return Excluded("plan not stated")

    variant = VARIANT_GROWTH_RE.match(option_text)
    if variant:
        return Excluded("institutional/retail-named plan (used only when the fund has no plain Growth line)",
                        variant_of=Included(asset_class, category, plan, "Growth", source))
    if OPTION_SPECIAL_RE.search(option_text):
        return Excluded("special-purpose plan (unclaimed, institutional, discontinued, bonus…)")
    growth = GROWTH_RE.match(option_text)
    if not growth:
        return Excluded(f"not the Growth option: {option_text!r}")
    stated_plan = growth.group(1)
    if stated_plan and stated_plan.lower() != plan.lower():
        return Excluded(f"plan conflict: Plan column {plan_text!r}, option {option_text!r}")
    return Included(asset_class, category, plan, "Growth", source)


# PulseDB's plan names (mf/nav_bm plan_name): "Broker" is the Regular plan.
PULSE_PLAN = {"direct": "Direct", "broker": "Regular", "regular": "Regular"}
NOT_STATED = ("option not stated", "plan not stated")


def pulse_plan_fill(row, verdict, pulse_row: dict | None) -> Included | None:
    """A scheme AMFI leaves without a plan or option (daily file blank, Scheme Master silent — e.g. Motilal Oswal BSE
    Enhanced Value Index Fund, 150518 / 150519): Included as PulseDB states it, only when Pulse lists the same scheme
    code as a Growth option of a Direct / Regular plan. AMFI's printed values are never overridden."""
    if not isinstance(verdict, Excluded) or verdict.reason not in NOT_STATED or not pulse_row:
        return None
    plan = PULSE_PLAN.get(str(pulse_row.get("plan_name") or "").strip().lower())
    if plan is None or str(pulse_row.get("option_name") or "").strip().lower() != "growth":
        return None
    printed = PLAN_MAP.get(row.plan.strip().lower()) if row.plan.strip() else None
    if printed and printed != plan:
        return None   # AMFI prints a different plan: AMFI wins, the scheme stays out
    asset_class, category = section_category(row.section)
    return Included(asset_class, category, plan, "Growth", "pulse")


def is_valid_isin(isin: str | None) -> bool:
    """ISIN check digit (same rule as calculation-engine/identity/isin.js)."""
    if not isin or not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
        return False
    digits = "".join(str(int(ch, 36)) for ch in isin)
    total = 0
    for position, ch in enumerate(reversed(digits), start=1):
        value = int(ch) * (2 if position % 2 == 0 else 1)
        total += value - 9 if value > 9 else value
    return total % 10 == 0
