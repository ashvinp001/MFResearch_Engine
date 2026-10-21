# Report Details Logic: Diversification, Risk Profile, Horizon

> **Authoritative source:** `MF_Calculation_Engine.md`, section E15.5.6. This page is an
> explanatory copy; if the two ever differ, the Calculation Engine file wins.

These three values fill the **Report details** automatically: Risk profile, Horizon and
Diversification on the Final review, and Risk profile and Investment horizon on the One-Pager. The
advisor can change any of them. Each field shows why it has its value ("Auto · …"), or "Changed by
you · logic gives …" after a manual change.

| What | Where |
|---|---|
| The three rules (exact tables) | `calculation-engine/portfolio-analyzer/report-profile.js` |
| SEBI category of each fund | `calculation-engine/portfolio-analyzer/fund-category.js` |
| Tests (every band edge) | `tests/engine.test.js` — "Fund category", "Diversification", "Risk profile", "Horizon", "Report profile" |
| Notes shown on screen | `app/portfolio-analyzer/report-profile-notes.js` |

---

## 1. Diversification

Inputs: num_funds, portfolio_value (INR), [optional] fund_values list.

Ideal fund range by portfolio value:

| Portfolio value | Ideal funds |
|---|---|
| < ₹5L | 2–4 |
| ₹5L–₹25L | 3–6 |
| ₹25L–₹1Cr | 4–8 |
| ₹1Cr–₹5Cr | 5–10 |
| > ₹5Cr | 6–13 |

Decide status (first match wins):

1. 1 fund, OR any fund ≥ 50% of value → **Concentrated**
2. num_funds < range minimum → **Under Diversified**
3. num_funds > range maximum → **Over Diversified**
4. otherwise → **Well Diversified**

## 2. Risk Profile

Risk profile = value-weighted equity exposure % of the portfolio.

Step 1: equity factor per holding (by SEBI category)

| Category | Factor |
|---|---|
| Equity funds (all: large/mid/small/flexi/multi/ELSS/index) | 1.00 |
| Aggressive Hybrid | 0.70 |
| Balanced Hybrid / Balanced Advantage / Dynamic AA | 0.50 |
| Multi-Asset | 0.40 |
| Equity Savings | 0.30 |
| Conservative Hybrid | 0.20 |
| Gold / Silver / Commodity | 0.30 |
| Arbitrage | 0.00 |
| Debt / Liquid (all) | 0.00 |

Step 2: equity% = Σ(value × factor) / Σ(value) × 100

Step 3: band the equity%

| Equity % | Risk profile |
|---|---|
| < 20% | Conservative |
| 20–40% | Moderately Conservative |
| 40–60% | Moderate |
| 60–80% | Moderately Aggressive |
| ≥ 80% | Aggressive |

## 3. Horizon

Horizon = value-weighted ideal holding period (years) of the holdings.

Step 1: years per holding (by SEBI category)

| Category | Years |
|---|---|
| Overnight, Liquid | 0.25 |
| Ultra-Short, Low Duration, Money Market, Floater | 0.75 |
| Arbitrage | 0.75 |
| Short Duration, Corporate Bond, Banking & PSU | 2.0 |
| Conservative Hybrid, Equity Savings | 2.5 |
| Medium Duration, Credit Risk, Dynamic Bond | 3.5 |
| Balanced Hybrid, Balanced Advantage, Multi-Asset, Gold | 4.0 |
| Gilt, Medium-to-Long Duration | 4.5 |
| Aggressive Hybrid | 5.0 |
| Long Duration | 7.0 |
| Equity (large/flexi/multi/ELSS/index/sectoral) | 7.0 |
| Mid Cap | 8.0 |
| Small Cap | 10.0 |

Step 2: avg_years = Σ(value × years) / Σ(value)

Step 3: band

| Average years | Horizon |
|---|---|
| < 1 yr | Short Term |
| 1–3 yr | Mid Term |
| 3–5 yr | Mid to Long Term |
| ≥ 5 yr | Long Term |

---

## How it is applied

- **Values:** each fund's current value as printed on the CAS. Sums use integer paise, and factors
  and years are held ×100 as integers. Every band comparison is exact, so 80.00% is Aggressive and
  79.99% is Moderately Aggressive.
- **Band edges:** each band includes its lower edge (20% → Moderately Conservative, 1 yr → Mid
  Term, ₹5L → ₹5L–₹25L). ₹5Cr exactly is in ₹1Cr–₹5Cr, because the last band is "> ₹5Cr".
- **Funds:** active holdings only (zero closing units are left out). The same ISIN held in
  several folios counts as one fund, with its values added together, for both the count and the
  "≥ 50%" test.
- **SEBI category:** a CAS does not print it. It is taken from fund data when connected, otherwise
  from the scheme name, but only when the name states the category plainly ("Flexi Cap",
  "Small Cap", "Liquid", "Gilt", "Banking & PSU", "Balanced Advantage", "Nifty 50 Index", "ELSS"…).
- **Never guessed:** if any fund cannot be classified, Risk profile and Horizon are left blank, the
  funds are named on screen, and the advisor chooses. Diversification does not need categories and
  is always filled. Examples that are not classified:
  - "Kotak Emerging Equity" (mid cap or large & mid? the name does not say)
  - "Nippon India Growth"
  - international funds, debt index or target-maturity funds, retirement/children's funds
  - "Commodities" equity funds
- **Interpretations** (categories the tables do not name explicitly):
  - Silver is treated like Gold (4.0 years; factor 0.30 as "Gold / Silver / Commodity").
  - Large & Mid Cap, Focused, Value, Contra and Dividend Yield funds use the Equity row (factor
    1.00, 7.0 years).
  - Index funds that track mid- or small-cap indices are SEBI "Index Funds", so they get 7.0 years,
    not 8 or 10.

## Worked example (sample client, 13 funds, ₹5,70,982)

- **Risk:** (₹4,88,956 equity × 1.00 + ₹79,172 gold/silver × 0.30 + ₹2,854 gilt × 0) / ₹5,70,982 =
  **89.79% → Aggressive**
- **Horizon:** (₹4,66,056 × 7 + ₹22,900 small cap × 10 + ₹79,172 × 4 + ₹2,854 × 4.5) / ₹5,70,982 =
  **6.69 yrs → Long Term**
- **Diversification:** 13 funds; ₹5L–₹25L allows 3–6 → **Over Diversified** (largest fund 21.9%)
