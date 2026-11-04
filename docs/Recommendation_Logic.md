# Prosperr — Invest / Hold / Sell Recommendation Logic · v2.3

> **v2.3 (04-Nov-2026, owner's decision). Small funds whose rating is pending are decided on their last year.** A fund
> with under 3 years of NAVs (REVIEW "young", or held while recovering) that is **below 8% of the portfolio** (all its
> folios and plans together) gets Hold or Sell instead of waiting for the advisor; 8% or more stays the advisor's call
> (`fund-grading.js gradeYoungSmall`, config `youngSmallMaxWeightPct` / `youngLaunchHoldPct`):
>
> | Record | Hold | Sell |
> |---|---|---|
> | 1 year or more | 1Y within 1 pp of the category median or ahead (0.3 pp for debt / arbitrage), not in the bottom quarter | the worst performers — bottom quarter of the category over 1Y (debt / arbitrage: and clearly behind), even if recovering — or more than the gap behind |
> | 1 year or more, sectoral / thematic | 1Y within 1 pp of its own index or ahead (its peers are other sectors) | further behind its index |
> | Under a year, equity / sectoral | absolute return since launch **above 15%** | 15% or less |
> | Under a year, hybrid / debt / arbitrage | 6M (else 3M) within the gap of the category median (a 15% hurdle is an equity return) | further behind |
>
> No figure to judge on (no category median, no index, under 3 months) → stays REVIEW: nothing is guessed. Hold is graded
> MIXED and Sell WEAK, so **Stage 2 then checks the fit** like any fund (a held young fund at or below 5% is still cleaned
> up; overlap, fund count and limits apply). The peer statistics carry the new `rLaunch` (absolute return from the first
> NAV, funds under a year only). The PDF says plainly that the rating is pending and what the last year shows.
>
> **The only overseas fund is kept, however small** (owner): it is the client's international exposure, so neither the 5%
> clean-up nor the fund count sells it (as for the only gold, debt or hybrid fund), and the Suggestion Box suggests new
> money for it, in rupees, to bring it to about 10% of the portfolio (`fit.overseasSuggestPct`).

> **v2.2 (04-Nov-2026, owner's decisions).** Where the money goes, and small holdings:
> - **Small holdings are cleaned up.** A fund **at or below 5% of the portfolio** (owner: one fixed rule, not by portfolio
>   size; `fit.cleanupMaxPct`) exits **whatever its own record** — it is too small to change the
>   result. A good fund is told plainly that this only consolidates the portfolio and is not a view on the fund (screen and
>   PDF). Kept: units in the ELSS lock-in, a REVIEW fund (the advisor decides), and the only gold / silver, debt or hybrid
>   fund (selling it would change the asset mix, not only tidy it); where several are that small, the largest stays and the
>   smaller consolidate into it (least selling and tax). Not counted in the staged fund-count budget.
> - **The limits are applied first; then the money moves** (§5.4). One plan for all the sales: each fund takes money only
>   up to its own room (one fund 20% or the equal share, its Mid / Small Cap category, its fund house 25%, its theme, the
>   index-fund 20%). In order: the fund a sale gave way to → **gold / silver or overseas to the kept fund of its kind, up to
>   its 15% / 30% limit (gold stays gold); the rest goes on** → a small holding to the INVEST fund of its own category →
>   the INVEST funds of the same side, equity **a step at a time to the fund that best fills the Large / Mid / Small gap**,
>   debt to the debt fund furthest below the others → what no fund can take to the Prosperr Recommended Portfolio.
> - A sale's money can now be **split** (for example "SBI Gold Fund (about 40%) and HDFC Mid Cap Fund (about 60%)"), and the
>   Suggestion Box ends with **where all the money goes**, in rupees, fund by fund.

> **v2.1 (04-Nov-2026, owner's decisions).** Category allocation at portfolio level, and three corrections:
> - **Mid Cap and Small Cap funds have a portfolio limit by basket** (all funds of the category together): Conservative
>   Mid 15% / Small 10%, Balanced 25% / 15%, Growth 30% / 20%. Large Cap is the core and has no cap; Flexi, Multi and
>   Large & Mid Cap funds are not capped by category. Above the limit the funds share it by performance (equal, or
>   60 / 40 when one of two is clearly better); an INVEST fund in a category at its limit takes no new money.
> - **One fund house at most 25%** (was 40%); in a portfolio of fewer than 4 funds, its equal share.
> - **Money from a sale goes to INVEST funds only while they have room** under the one-fund limit; otherwise to the
>   Prosperr Recommended Portfolio, so no fund is pushed above its limit by the money from another (§5.4).
> - **Index-fund tracking:** a missing return to the index's date now means "no tracking figure" (HOLD), never "trails
>   its index".
> - A REVIEW fund is still never reduced automatically; the Suggestion Box says so when it keeps a category above its limit.
> - **Audit fixes (04-Nov-2026, 4 CAS + 2,000 portfolios):** a gold / silver or overseas fund exited because another of
>   its kind is kept **consolidates into that fund** (gold stays gold; only into a fund not being cut, while its group has
>   room); sectoral / thematic and gold / overseas INVEST funds are **satellites** and never take the core's proceeds;
>   among debt and arbitrage funds the **STRONG ones stay first, the larger ones first** (no STRONG debt fund sold to keep a
>   smaller one); the Suggestion Box names **where new money should go first** when a Large / Mid / Small segment is 10
>   points or more below the basket (the diversified INVEST fund with most of that segment), or says to add one.


> **v2.0 (02-Nov-2026, owner's decisions).** Stage 2 is rebuilt as one decision for the whole portfolio, so no call can
> contradict another (§5):
> - **One ranking.** Every comparison uses one order: the Stage 1 grade, then the fund's place inside this portfolio.
> - **One walk, best fund first.** A fund gives way only to a stronger fund that takes new money: no chain, no two funds
>   pointing at each other, and a STRONG fund never gives way to a MIXED one.
> - **Money moves only to a final INVEST fund.** When a limit takes an INVEST away, the decision runs again.
> - **The Stage 1 grade is never rewritten.** A sale for overlap or fit does not make a fund WEAK.
> - **Partial sales.** A fund above a limit is cut to the limit, with the percentages, the amount and the reason.
> - **Index funds / ETFs:** at most 20% of the portfolio together, and at most 2–3 funds.
> - **Consolidation is staged:** the same rule at every size, at most 25% of the portfolio per review for the fund count.
> - **Stage 1:** a SELL needs independent evidence; a sector fund ahead of its own index is kept; STRONG never has a
>   negative Risk or Benchmark pillar. Joining Stage 1 to the Fund Scorecard is left for later (owner's decision).

> **v1.4 (23-Oct-2026, owner's decisions):** Stage 2 now judges each fund **inside this portfolio** (§5.2):
> - (Replaced by v2.0 §5.) **Too many funds for the portfolio's size** (its own Diversification range) → the weakest Hold funds exit,
>   small holdings first, until the count is back in range. A small holding is relative to the portfolio, not fixed.
> - **Index funds / ETFs**: at most 2 (portfolios whose ideal maximum is ≤ 6 funds) or 3 → the extra ones exit.
> - **Sectoral / thematic, gold / silver, overseas above 15%** → the weaker fund of that group exits; a fund house
>   above its limit (25% from v2.1) or a theme still above its limit takes no new money (INVEST → HOLD).
> - **High overlap** now from **50%** (was 60%).
> - A **Suggestion Box** (screen and PDF) lists the portfolio-level points from the same conditions.
> - Risk profile / horizon fit is left for the Financial Plan (owner's decision) — not used here.
> - Real CAS (29 funds, ideal 4–8): 8 INVEST · 3 HOLD · 17 SELL · 1 REVIEW (v1.3: 8 · 17 · 3 · 1).

> **v1.3 (22-Oct-2026, owner's decisions):**
> - **One fund = one call.** The same scheme (same AMC and scheme name) held in several folios, or in both its
>   Regular and Direct plans (the same portfolio), is judged once, on the larger holding, with the combined share
>   of the portfolio. Every folio gets the same verdict and reason, plus a note: merge the folios through the
>   registrar (no sale needed — selling one folio would only trigger tax / exit load), or consolidate into one plan.
>   The ELSS lock-in is still checked per folio. The PDF writes one entry per fund (folios combined); folios the
>   advisor gives different verdicts are listed separately, named by folio.
> - **High overlap.** Two actively managed diversified equity funds whose equity holdings are ≥ 60% (50% from v1.4) the same stocks
>   (PulseDB holdings; overlap = Σ min(weight A, weight B) over common stocks) are compared on the measures both
>   have — 3Y / 5Y vs category, consistency, Sharpe, drawdown, 3Y / 5Y vs benchmark (at least 4). The one worse on
>   more than half: **SELL** ("consolidate into the stronger fund") when it is not STRONG; **HOLD, no new money**
>   when it is STRONG (a strong fund is not sold for overlapping). Index funds and hybrids are not compared this
>   way (an index fund naturally overlaps a large-cap fund; a hybrid's equity is only part of it).
>   On the real CAS: ICICI Large Cap × ICICI Dividend Yield 61% → ICICI Large Cap HOLD (the other is better on 5 of 7).

> **v1.2 (22-Oct-2026, owner's decisions):** (a) no "Regular plan → switch to Direct" note — both plans are
> recommended; (b) **sector check** for sectoral / thematic funds and sector index funds / ETFs (§4.2a).

> **v1.1 (22-Oct-2026, owner's decisions):** each fund's **own benchmark** is now a pillar (B). It breaks "in line"
> ties both ways; index funds are judged on tracking; sectoral / thematic funds, and funds with too few peers,
> are judged against their own index; the 1Y guard is 5 pp (was 2 pp); in a category with several funds the
> best gets INVEST, the others HOLD, and a duplicate behind both its category and its benchmark on every
> horizon gets SELL. On the real 29-fund CAS: v1.0 = 4 INVEST · 21 HOLD · 2 SELL · 2 REVIEW →
> v1.1 = 9 INVEST · 16 HOLD · 3 SELL · 1 REVIEW (§8).

> **Status:** implemented and tested; ready for the owner's own testing. All thresholds sit in one place,
> `calculation-engine/config.js → RECOMMENDATION`, and can be changed without touching the code.
> **Built from the best of two sources:**
> - `fund_analyzer.js` (Claude) supplied the **engine**: the two-stage design, grading against the fund's own
>   category, 3Y + 5Y persistence, consistency, risk, per-asset-class rules, the ELSS lock-in and the
>   Regular→Direct note.
> - `CLAUDE logic.md` (ChatGPT) supplied the **safeguards**: never invent data, no SELL on a single metric, a
>   REVIEW status, portfolio observations as flags (never forced sales), every call explained, and a manual
>   override.
> Every condition appears **once**. Where the two overlapped, the safer version was kept.

---

## 0. Wrong calls in the original engine, and how they were fixed (each one is now a test)

| # | Case | `fund_analyzer.js` | Now | Rule |
|---|---|---|---|---|
| 1 | Two strong Large Cap funds | SELL the 2nd ("duplicate") | best INVEST, other HOLD | §5.2 |
| 2 | Strong returns, only consistency weak | SELL | HOLD | §3 |
| 3 | Strong returns, alpha slightly negative | SELL | not SELL | §3 |
| 4 | 12 good funds in 12 categories | 2 trimmed → SELL | 12 × INVEST | §5.4 |
| 5 | Index fund, tracking error 0.01% worse | SELL | HOLD | §4.5 |
| 6 | Debt fund, risk data missing | SELL | HOLD (unknown ≠ fail) | §1 |
| 7 | Gold FoF | SELL | HOLD + exposure flag | §4.6 |
| 8 | Any fund | only KEEP / SELL | INVEST defined | §6 |

---

## 1. Ground rules

1. **Data first.** A figure that is missing or cannot be computed is **UNKNOWN (?)**. It never passes and
   never fails a test, and it is never replaced by 0 or an estimate.
2. **No single-metric SELL.** Stage 1 needs persistent under-performance (pillar R, §3) **plus** independent evidence:
   Risk or Benchmark, or Rank and Consistency together (each of those two comes from the same returns as R).
   Stage 2 sales are about the portfolio, not the fund's own record, and say so.
3. **Compare like with like.** The peer group is the same **AMFI category, asset class and plan**
   (Direct vs Direct, Regular vs Regular, ETF vs ETF), over the same periods and at the same data date.
   - AMFI's labels are used exactly as published; nothing is merged or renamed.
   - A median or rank needs **at least 5 funds**; otherwise it is UNKNOWN.
4. **CAS gain on cost is not performance.** It is shown but never used to grade a fund.
5. **Explain every call:** the figures, the peer group and its size, the data date and the rule that decided.
6. **The advisor decides.** The logic pre-fills Invest / Hold / Sell and any fund can be changed. A changed
   fund shows "Changed by you · logic suggests …" with a "Use suggested" reset.
7. **All maths follows MF_Calculation_Engine.md:**
   - E1: NAV lookup (nearest previous, 10-day cap)
   - E2: returns (≤ 12 months simple; > 12 months CAGR on actual days)
   - E9: quartile (the owner's Excel formula)
   - E12: risk (36 month-end returns, STDEV.S × √12, Rf 6.5%; max drawdown)

---

## 2. Inputs per fund and their sources

| Figure | Definition | Source |
|---|---|---|
| `r1y`, `r3y`, `r5y` | E2 trailing returns at the fund's latest NAV | NAV store (Supabase) |
| category median 1Y / 3Y / 5Y | median of the peer group | peer statistics (daily) |
| `e1`, `e3`, `e5` | fund return − category median, in percentage points (pp) | derived |
| `rank3y`, `quartile3y` | rank on 3Y within the peer group (1 = best; ties share a rank), E9 quartile | peer statistics |
| `consistency` | share of the last **24 monthly rolling 3Y windows** in which the fund's 3Y CAGR was at or above that window's category median (needs ≥ 12 windows) | peer statistics |
| `sharpe3y`, Sharpe quartile | E12 R2; quartile within the peer group | peer statistics |
| `maxDrawdown3y` | E12 R5 over the last 3 years of daily NAVs | peer statistics |
| `worstDay3y` | largest fall between two consecutive NAVs in the last 3 years | peer statistics |
| weight | current value ÷ portfolio value (latest NAV) | CAS + NAV |
| credit quality | share of the fund's debt + cash rated AAA / A1+ / Sovereign, plus cash | PulseDB holdings (ratings) |
| ELSS locked units | units bought in the last 3 years (FIFO: redemptions use the oldest units first) | CAS transactions |
| `b1`, `b3`, `b5` | fund return − **its own benchmark's** return over the same period, at the fund's NAV date (E2), pp | benchmark bucket (PulseDB prices, daily) via peer statistics |
| alpha, beta | vs the benchmark (E12 R4) | later, from the same benchmark data |

**Peer statistics**
- Computed every morning after the 7:00 AM NAV update by `data-pipeline/peer_stats.py`.
- Scope: all ~3,800 current funds in 108 peer groups.
- Stored in Supabase at `stats/peer-stats.json` and served to the site by `/api/peer-stats`.
- A fund whose latest NAV is more than 7 days old is left out of every peer group.

---

## 3. Stage 1: the pillars (equity and hybrid, active funds)

Each pillar is **+** (positive), **−** (negative), **=** (neutral) or **?** (unknown).

| Pillar | + | − |
|---|---|---|
| **R · Return persistence** (T = 1.00 pp) | e3 ≥ 0 **and** e5 ≥ 0 | e3 < −T **and** e5 < −T |
| R, when there is no 5Y comparison | e3 ≥ 0 **and** e1 ≥ 0 | e3 < −2T **and** e1 < 0 |
| **K · Rank** | 3Y quartile Q1 | 3Y quartile Q4 |
| **C · Consistency** | ≥ 65% of rolling windows | < 40% |
| **S · Risk** | Sharpe ≥ category median **and** drawdown no deeper than the median | Sharpe in Q4 **and** drawdown deeper than the median |
| **B · Own benchmark** (gap 1.00 pp) | b3 ≥ 0 **and** b5 ≥ 0 (b3, b1 without 5Y) | b3 < −1 **and** b5 < −1 (b3 < −2, b1 < 0 without 5Y) |

B is unknown (never a fail) when the fund has no verified benchmark: ETFs, gold funds, a few unmapped funds,
and funds whose benchmark is a Pulse-made multi-index blend — those blends do not follow their stated weights
(checked 22-Oct-2026) and are not used until built from their component indices (MF_Calculation_Engine.md E7).

1Y is never used alone. It appears only inside R (when there is no 5Y comparison) and in the INVEST guard (§6).

### Grade (first match wins)

| Grade | Rule |
|---|---|
| **REVIEW** | no 3Y comparison is possible (see §4.7) |
| **WEAK** | R − **and** (S − or B −, or both K − and C −) |
| **STRONG** | R + **and** C + **and** (K + or S +), with neither S nor B −. If C is unknown: R + **and** K + **and** S + |
| **STRONG** (v1.1) | R + **and** B + **and** none of K, C, S is − — ahead of both the category and its own benchmark on 3Y and 5Y |
| **WEAK** (v1.1, "in line" but behind both) | behind the category median on 3Y and 5Y (any margin) **and** B − **and** none of K, C, S is + |
| **MIXED** | everything else: the evidence genuinely disagrees. R − with nothing confirming it is MIXED with the note "watch" |

**1-year rule (owner, v2.0) — young funds only** (no 3-year record; their year is all the record there is). A fund in the
bottom quarter of its category over 1Y, and behind its median by more than 2 pp (0.3 pp for debt and arbitrage, whose
funds sit within basis points of each other), is **held** when it is at or above
the category median over 6M or 3M (recovering), and becomes **WEAK → SELL** when it is below on both. Any other young fund
stays **REVIEW** (the advisor decides), as does a fund under one year old. Established funds are judged on 3Y and 5Y. The 3M / 6M returns and the 1Y rank come from the daily peer statistics.

The benchmark never decides alone: every SELL needs the category comparison to agree.

---

## 4. Rules by fund type

### 4.1 Equity, diversified
Large, Large & Mid, Mid, Small, Flexi, Multi, Focused, Value, Contra, Dividend Yield and ELSS funds follow
§3 exactly as written.

### 4.2 Equity, sectoral / thematic
AMFI's "Sectoral/Thematic", "Thematic Fund" and "Sectoral Fund" groups mix unrelated sectors, so these funds
are judged **only against their own (sector / theme) benchmark**:
- ahead of it on 3Y and 5Y (B +) → **INVEST**
- behind it by more than 1 pp on 3Y and 5Y **and** behind it over the last year too → **SELL**
- otherwise, or without benchmark data → **HOLD**

They are never ranked against each other (different sectors). The thematic-concentration flag (§5) still applies.

### 4.2a Sector check (v1.2) — is the whole sector performing?
The **sector index** is compared with the broad market (**NIFTY 500**, total return, same anchor date):
- **not performing** = behind by more than **2 pp a year on 3Y and 5Y** (more than 4 pp on 3Y without a 5Y
  figure) **and** behind over the last **1Y** too. A sector that is recovering over the last year is not sold
  (that would be selling at the bottom).
- **ahead** = level or ahead on 3Y and 5Y (3Y and 1Y without 5Y).

How it is used:
| Fund | Sector not performing | Sector ahead | Otherwise |
|---|---|---|---|
| Active sectoral / thematic fund (benchmark is a sector index) | **SELL** if the fund is behind the market on 3Y and 5Y **and** not ahead of its own index; otherwise **HOLD**, no new money | the own-index rule above (§4.2) | §4.2 |
| Sector index fund / ETF | **SELL** | **INVEST** (if it tracks its index within 1 pp a year, when known) | **HOLD** |

- The sector is measured on the **sector index itself** (the fund's mapped benchmark), so every fund on that index
  gets the same verdict. An ETF without a mapping is measured on its own NAV — only when that history has no break
  (a unit split shows as a one-day fall of more than 20%, or a return more than 40 pp a year away from the market);
  otherwise "cannot be judged" → HOLD.
- Not applied to broad, factor (momentum, value, quality…), debt or overseas index funds, nor to thematic funds
  benchmarked to a broad index. Gold / silver stay HOLD by type (§4.6); NIFTY Commodities is an equity sector.
- Checked on live data (22-Oct-2026): of 240 sector index funds / ETFs, 4 not performing (all four BSE Housing
  index funds: 3Y −4.30 pp, 1Y −7.75 pp vs NIFTY 500), 20 ahead (e.g. Pharma, Healthcare, Auto, PSU Bank, CPSE),
  35 in line, 12 with a unit-split break in their NAV (not judged), 169 under 3 years or without data.

### 4.3 Hybrid
Aggressive, Balanced Advantage / Dynamic, Multi-Asset, Equity Savings, Conservative and Balanced funds follow
§3 against their **own** hybrid category.

### 4.4 Arbitrage
Only R and K count:
- R, K and B are the only measures (§4.5 gives the rule)
- otherwise MIXED

### 4.5 Debt
- **R** uses T = **0.30 pp**, because spreads between debt funds are small. **B** (own benchmark) as in §3, 1.00 pp.
- **S** compares the 3Y drawdown with the category median:
  - **+** if the drawdown is no deeper than the median
  - **−** if it is deeper by more than 0.5 pp
- **Q (credit quality)** is read from the holdings' ratings:
  - **+** at 80% or more in AAA / A1+ / Sovereign / cash
  - **−** below 60%
  - **?** if more than 10% of the debt is unrated (non-government)
  - **Credit Risk Fund is exempt:** low ratings are its mandate.
- **Credit-event guard:** a one-day NAV fall worse than −1% in the last 3 years in a short or medium debt
  fund → **REVIEW** ("possible credit event — check before acting"). Gilt, long-duration, dynamic and
  constant-maturity funds are exempt, because interest rates move their NAVs.
- **Grades:**
  - **WEAK** = R− and (S− or Q− or B−) — rank alone is the same returns as R, so it never confirms a SELL; or behind
    the category on 3Y and 5Y and B−, nothing positive
  - **STRONG** = R+ and (K+ or S+ or B+), with none of S, Q, B −
  - **MIXED** otherwise

Arbitrage adds B the same way: WEAK = R− and B−; STRONG = R+ and (K+ or B+), with neither −.

### 4.6 Index funds / ETFs, and HOLD by type
**Index funds and ETFs** are judged on tracking: fund 3Y return − its index's 3Y return.
- within −1.00 pp a year (or ahead) → **INVEST**
- further behind → **HOLD** ("trailing its index")
- under 3 years, or no benchmark data (ETFs are not in the benchmark mapping) → **HOLD**
- two index funds on the **same index**: the stronger gets INVEST, the other HOLD ("consider consolidating").

**HOLD by type (never auto INVEST or SELL):**
- **Gold / silver / commodity funds:** held for diversification.
- **Overseas FoF:** no like-for-like Indian peer group.
- **Domestic FoF:** the result depends on the underlying funds.
- **Solution-oriented funds** (retirement, children's): goal-based, with a lock-in.

### 4.7 REVIEW: not pre-selected, the advisor decides
| Situation | Reason shown |
|---|---|
| Not in the AMFI Growth list (e.g. an IDCW plan) | no NAV comparison possible |
| AMFI "(legacy)" category | no clean peer set |
| Less than 3 years of NAV history | "Only X years of NAV history" |
| Fewer than 5 peers with a 3Y record **and no benchmark data** | no fair comparison (with a benchmark, the fund is judged against it alone, as in §4.2 — e.g. Regular Contra: 3 funds) |
| No peer statistics for the fund | NAV not current (more than 7 days old) or not stored |
| Debt credit-event guard (§4.5) | as stated |
| Weak ELSS with no transaction history in the CAS | lock-in cannot be determined |

---

## 5. Stage 2: one decision for the portfolio

Every step is in `portfolio-fit.js`, in this order. Steps never rewrite the Stage 1 grade.

### 5.1 One ranking
Funds are ordered by the Stage 1 grade, then by a score (0–100): the fund's percentile among the funds held, on the
measures it has: return lead over its category (else its benchmark), Sharpe and drawdown against the category median,
consistency, and overlap with the other funds (less is better). Category, index and overlap decisions and the
exit order all use this one order, so they cannot disagree.

**One fund = one call:** the same scheme in several folios or both plans is judged once (v1.3).

### 5.2 Fund against fund
Before the walk, a STRONG fund above 20%, or more than 5 pp behind its category over 1Y, takes no new money.

The funds are walked **best first**. A fund has the same exposure as an earlier INVEST fund when it is in the same AMFI
category (active funds), tracks the same index (index funds, sectoral funds), or shares at least 50% of its stocks
(active equity funds, on at least 4 comparable measures).
- No such fund, and STRONG with nothing stopping it → **INVEST**.
- STRONG → **HOLD**, new money goes to that fund. A STRONG fund is never sold for this.
- MIXED with high overlap → **SELL**, consolidate into that fund.
- MIXED in the same category, behind its category and its benchmark on both horizons by more than 0.5 pp, with no
  positive pillar → **SELL**, consolidate into that fund.
- Anything else → **HOLD**, with a note.

Two funds that overlap with no INVEST fund between them are both held; the weaker is first in line in a consolidation.

### 5.3 Limits

| Step | Limit | Action |
|---|---|---|
| Index funds / ETFs (equity; not gold, silver or debt) | at most 2 funds when the ideal maximum is ≤ 6, else 3; at most 20% together | a second fund on an index already held exits first, then one from the segment furthest above the basket, then the weaker tracker; the rest share the 20%: equal when alike, 60 / 40 when only the better fund is STRONG |
| All index funds poor | every one trails its index beyond the tracking limit | all exit; the Suggestion Box names the NIFTY 50 fund with the best average tracking difference over 1, 3 and 5 years for 10% of the portfolio |
| Themes | sectoral / thematic (with sector index funds) and gold / silver: 15% each | cut to the limit, weakest first; a non-STRONG fund that fits inside the excess exits in full |
| Overseas | overseas FoFs and index funds, Indian thematic funds on an overseas index (US Equity, S&P 500) and domestic FoFs holding overseas funds: 30% together | the funds share the limit: equally, or 60 / 40 when one of two is clearly better (20 or more score points) |
| Debt + arbitrage | no limit on the total; very few funds: at most 2 (1 when the ideal maximum is ≤ 4), in equal shares | the strongest stay, the others exit; the money stays in debt when a debt fund is INVEST. Larger funds are cut to the equal share only then, else the box states the target |
| One fund | 20%, or an equal share when fewer than five funds remain | cut to the limit. Index funds are under their own limit; debt and arbitrage funds are left out, because moving them would change the portfolio's risk |
| Fund count | the Diversification range: < ₹5L 2–4 · ₹5L–25L 3–6 · ₹25L–1Cr 4–8 · ₹1Cr–5Cr 5–10 · > ₹5Cr 6–13 | exits, staged (below) |
| Mid Cap / Small Cap funds (v2.1) | by basket, all funds of the category together: Conservative 15% / 10%, Balanced 25% / 15%, Growth 30% / 20%; Large Cap no cap | the funds share the limit by performance (equal, or 60 / 40 when one of two is clearly better); a cut under 1% or a fund that cannot be sold stays and the others give up more, weakest first |
| Fund house, theme, index funds, Mid / Small Cap at their limit | 25% (equal share below 4 funds) / 15% / 20% / basket | INVEST → **HOLD**, no new money; the next STRONG fund takes its place |

A cut smaller than 1% of the portfolio is not worth the transaction and tax and is left alone (when one index fund's cut is
too small, the others take it, so index funds still end at 20%). A cut that would leave less than a small holding becomes a
full exit. A debt or arbitrage fund is never stopped for being above 20%. Units in the ELSS lock-in are never sold, and a fund kept by its
lock-in stays in every count.

**Fund count — the same rule at every size.** One fund at a time exits until the count is in range:
- **v2.2:** small holdings (below ¼ of the average share at the ideal maximum) are already cleaned up before this step,
  whatever their record (see the v2.2 note at the top); the count then continues:
- **Order:** a fund that overlaps a fund kept →
  a fund in the part of the equity furthest above the basket (below) → a fund of a fund house above its limit →
  the weakest in the ranking.
- **Never:** an INVEST fund; a REVIEW fund; a STRONG fund, unless it is a small duplicate of an INVEST fund; an ELSS
  fund with locked or unknown units; the last hybrid, debt or gold fund.
- **Staged:** these exits sell at most 25% of the portfolio per review. The rest waits for later reviews, and the
  Suggestion Box says so. WEAK funds and limit cuts are not staged.

**Large / Mid / Small basket.** The reference follows the portfolio's risk profile and horizon (`report-profile.js`). Each
is placed in a tier, and the lower tier decides, because either one alone can rule out small caps:

| Basket | Risk profile | Horizon | Large / Mid / Small |
|---|---|---|---|
| Conservative | Conservative, Moderately Conservative | Short, Mid Term | 65 / 25 / 10 |
| Balanced | Moderate | Mid to Long Term | 50 / 30 / 20 |
| Growth | Moderately Aggressive, Aggressive | Long Term | 35 / 35 / 30 |

It has no hard limit: it steers which fund exits first, and the Suggestion Box shows the basket and the split after the changes.
Among index funds, the best average tracking difference (fund − index) over 1Y, 3Y and 5Y decides; AUM is not used.

### 5.4 Where the money goes (v2.2: one plan, after the limits)
The limits (§5.3) are applied first; then all the money from the sales is placed in one plan (`routeMoney`). A fund takes
money only up to its **room**: the smallest of the one-fund limit (20%, or the equal share; not index, debt or arbitrage
funds), its Mid / Small Cap category limit, its fund house limit, its theme limit and, for an index fund, the 20% index
group. In order:

| # | Money from | Goes to |
|---|---|---|
| 1 | a fund that gave way to a stronger fund (same category, index or stocks) | that fund, when it is INVEST, up to its room |
| 2 | a gold / silver or overseas fund | the kept fund of the same kind (not being cut), up to the 15% / 30% group limit — gold stays gold |
| 3 | a small holding | the INVEST fund of its own category, up to its room |
| 4 | everything still to place | the INVEST funds **of the same side** (equity to equity, debt to debt, so a sale never changes the risk on its own). Equity is placed ¼% at a time to the fund whose holdings best fill the segments below the Large / Mid / Small basket (re-read as the money arrives), then the stronger; debt to the debt fund furthest below the others. Sectoral / gold / overseas INVEST funds take only their own group's money |
| 5 | what no fund can take | the Prosperr Recommended Portfolio |

A sale's money can be split; the call shows each part as a share of the money, and the Suggestion Box ends with the total
to each fund in rupees. When a limit takes an INVEST away, §5.2–§5.3 run again until nothing changes, so money never goes to
a fund that is itself sold or closed to new money.

### 5.5 Suggestion Box (screen and PDF, end of Section 05)
It reads the same decision and states only what was done: the fund count and how far this review takes it, index funds,
each reduction with percentages and amount, fund houses, themes, overlap, funds still above 20%, the Large / Mid / Small
split, folios and plans.

---

## 6. Final mapping to the three buttons

| Situation | Pre-selected |
|---|---|
| STRONG, first in its exposure, no limit stops it | **INVEST** |
| STRONG, behind an INVEST fund, or stopped by a limit | **HOLD** |
| MIXED or a HOLD type (§4.6), not sold in §5.2–§5.3 | **HOLD** |
| WEAK, or sold in §5.2 / §5.3 | **SELL** (ELSS with locked units: **HOLD**) |
| Above a limit | **SELL**, a partial sale: from → to, amount and reason. The rest stays invested and counts as Hold in the summary |
| REVIEW | *nothing pre-selected*: the reason is shown and the advisor chooses |

**INVEST** means "a candidate for fresh money". It never means "buy more regardless of weight".

---

## 7. What the advisor sees (explanation and audit)

**Per fund**
- an **Auto** / **Review** / **Changed by you** tag with the one-line reason
- the 3Y gap to the category median
- a **Why** panel with:
  - the peer group (category · plan · number of funds)
  - every pillar, with its value and the median
  - the notes (consolidation, lock-in)

**At the top**
- how many funds were pre-selected and how many need review
- the logic version and the peer-data date

**Beside the list:** the Suggestion Box (§5.3). A portfolio-fit call's reason starts "Portfolio fit —".

---

## 8. Test results (all passing)

| # | Scenario | Expected | Result |
|---|---|---|---|
| T1 | Strong on every pillar, only fund in its category | INVEST | ✅ |
| T2 | Two STRONG funds in one category | best INVEST, other HOLD | ✅ |
| T2b | Best STRONG fund blocked by its 1Y lag | next STRONG fund INVEST | ✅ |
| T3 | 3Y and 5Y more than 1 pp below the median, bottom quartile | SELL | ✅ |
| T4 | 3Y and 5Y below the median, nothing else weak | HOLD ("watch") | ✅ |
| T5 | Strong returns, one weak metric (consistency / risk / rank) | never SELL | ✅ |
| T6 | 12 STRONG funds in 12 categories | 12 INVEST, 0 SELL | ✅ |
| T7 | Index fund / ETF with weak numbers | HOLD | ✅ |
| T8 | Debt fund with risk data missing | HOLD, never SELL | ✅ |
| T9 | Gold / silver / overseas / domestic FoF / solution-oriented | HOLD | ✅ |
| T10–11 | Fund under 3 years; fund not in the AMFI list | REVIEW, not pre-selected | ✅ |
| T12 | Weak ELSS: locked units / free units / no transactions | HOLD / SELL / REVIEW | ✅ |
| T13 | Sectoral fund: weak / strong | REVIEW / HOLD | ✅ |
| T14 | One-day fall above 1% in a short-term debt fund; same in a gilt fund | REVIEW; gilt exempt | ✅ |
| T15 | STRONG fund above 20%; STRONG fund with 1Y 5.5 pp behind; 1Y 3 pp behind | HOLD; HOLD; INVEST | ✅ |
| B1 | In line with the category, ahead of its benchmark 3Y & 5Y | INVEST | ✅ |
| B2 | Behind the category median 3Y & 5Y and > 1 pp behind its benchmark; same with a positive pillar; behind benchmark only | SELL; HOLD; HOLD | ✅ |
| B3 | Persistent under-performance confirmed by the benchmark; no benchmark | SELL; HOLD (B unknown) | ✅ |
| B4 | Index fund tracking within 1 pp / trailing more / no data; two funds on different indices; same index | INVEST / HOLD / HOLD; both INVEST; closer INVEST, other HOLD | ✅ |
| B5 | Duplicate behind category & benchmark on 3Y and 5Y; ahead on 5Y; weak duplicate ELSS with locked units | SELL; HOLD; HOLD (lock-in) | ✅ |
| B6 | Sectoral fund ahead of / behind on every horizon / mixed vs its own index; too-few-peers fund with a benchmark | INVEST / SELL / HOLD; judged on the benchmark | ✅ |
| T16 | Peer group under 5 funds | REVIEW | ✅ |
| T17 | Missing figures, stale data, no peer statistics | unknown, never 0; REVIEW; nothing pre-selected | ✅ |
| — | Credit quality from ratings; credit-risk exemption; arbitrage; legacy; flags | as §4–§5 | ✅ |
| T18 | Advisor changes a verdict | change kept, suggestion and reset visible | ✅ (screen) |
| T19 | Real CAS dry run (29 active funds) | every call explained and checked by hand | ✅ |
| T20 | Peer statistics recomputed independently in the browser engine (6 whole peer groups, 180 funds) | identical | ✅ 1,952 figures, 0 mismatches |
| P1 | 6 funds in a ₹1L portfolio (ideal 2–4) | the small Hold exits, then the weakest; the stronger Hold stays (6 → 4) | ✅ |
| P2 | Category leader, last gold fund, ELSS in lock-in; not enough candidates | all kept; the duplicate exits; stops honestly above the range | ✅ |
| P3 | 3 index funds where 2 suit the portfolio | the extra exits | ✅ |
| P4 | Count and index-fund limits both open | the exit relieving both is chosen first; fewest funds sold | ✅ |
| P5 | Thematic funds 22% (limit 15%); a lone strong thematic fund at 20% | the weaker exits; the lone one INVEST → HOLD | ✅ |
| P6 | One fund house at 45%, count within range | its INVESTs → HOLD; nothing sold | ✅ |
| P7 | Portfolio within every limit | Stage 2 changes nothing | ✅ |
| P8 | Suggestion Box: folios, both plans, overlap | listed, independent of the final calls | ✅ |
| P9 | 400 random portfolios (1–30 funds, every value band) | no large STRONG fund, locked ELSS or last gold fund exited; no exit without an open limit; count exits stop at the ideal maximum | ✅ |
| P10 | Overlap 55% / 45% | acted on / not | ✅ |
| P11 | PDF Sell commentary | "trails its peers" only for a fund graded WEAK; portfolio-fit exits say "consolidate" | ✅ |

| C1 | Same category and high overlap | one fund INVEST, never pointing at each other | ✅ |
| C2 | STRONG against a MIXED fund | STRONG stays INVEST | ✅ |
| C3 | Chain of overlapping funds | no consolidation into a sold fund | ✅ |
| C4 | Index funds: both good 24% / one poor / all poor / four good | 10–10 / 12–8 / all exit / best three stay | ✅ |
| C5 | Weak ELSS kept by its lock-in | stays in the fund count | ✅ |
| C6 | Overseas funds alike / one clearly better | share 30%: equal / 18–12 | ✅ |
| C6b | Debt at 70%; four debt funds | left alone; strongest stay, money stays in debt | ✅ |
| C6c | Risk and horizon | the lower decides the basket | ✅ |
| C7 | 20 funds, ideal 6–13 | 5 exit this review (25% of value); the rest staged | ✅ |
| C8 | Partial sale | from → to, amount, destination | ✅ |
| C9 | Weak equity fund, only debt funds INVEST | money to the Recommended Portfolio, never into debt | ✅ |
| C10 | Two funds on one index; a cut leaving a stub | the duplicate exits first; the stub exits in full | ✅ |
| Y1 | Young fund in the bottom quarter over 1Y: recovering / not; established fund | HOLD / SELL; not judged on 1Y | ✅ |
| Y2 | Gold-mining FoF; US equity thematic fund | overseas equity; inside the overseas limit | ✅ |

The dry runs below are from earlier versions and are kept as history.

**Real-CAS dry run, v1.4** (29 funds, ₹88.7L → ideal 4–8): 8 INVEST · 3 HOLD · 17 SELL · 1 REVIEW; 14 portfolio-fit exits, 12 funds
remain (the rest are INVEST funds, the last debt fund and a REVIEW fund — not forced out). Every exit checked:
the small holdings (US Treasury FoF 1.4%, Templeton Value 0.8%, Tata Pharma 1.1% …), duplicates of a STRONG fund
(SBI BAF 0.7% → HDFC BAF, ICICI Nifty 50 → HDFC Nifty 50, DSP Equity Savings → Mirae Equity Savings, HDFC Dividend
Yield → ICICI Dividend Yield, Mirae Midcap → Invesco Mid Cap), and the weakest (Axis ELSS 5Y −4.7 pp vs category,
Edelweiss Multi Asset 3Y −4.8 pp, HSBC Small Cap 3Y −1.6 pp). The strong large holdings stay (ABSL BAF 12%, ICICI Large Cap 5.8%).

**Real-CAS dry run, v1.1:** 9 INVEST · 16 HOLD · 3 SELL · 1 REVIEW (v1.0 was 4 · 21 · 2 · 2).
- New SELL: Mirae Asset Midcap (Regular) — behind the Mid Cap median (3Y −0.91, 5Y −0.03 pp) and its index
  (3Y −0.77, 5Y −1.77 pp) on both horizons, in a category where Invesco India Mid Cap is the stronger fund.
- New INVEST: HDFC Focused, HDFC BAF, ICICI Dividend Yield (1Y guard now 5 pp), DSP Large & Mid Cap (ahead of
  category and index on 3Y and 5Y), HDFC Nifty 50 Index Direct (tracking −0.30 pp a year), Kotak Contra (no
  peer group; +2.5 / +2.7 pp vs NIFTY 500).
- The 16 HOLDs: 5 strong funds behind a stronger one in the same category / index (owner's rule), 4 by type or
  level with their own index, 7 where category and benchmark disagree (e.g. Templeton Value: 3Y behind, 5Y
  ahead of its index).
- Benchmark figures verified: 1Y / 3Y / 5Y from the stored benchmark prices match Pulse's own trailing returns
  for 20 benchmarks (1Y exact; 3Y / 5Y within 0.02 pp).

**Real-CAS dry run, v1.0 (T19):** 4 INVEST · 21 HOLD · 2 SELL · 2 REVIEW.

The 2 SELLs were checked by hand against the raw stored NAVs (identical to 4 decimals):

| Fund | 3Y vs median | 5Y vs median | Rank | Other evidence |
|---|---|---|---|---|
| Mirae Asset Large & Midcap (Direct) | −1.7 pp | −1.7 pp | 22 of 26 | at or above the median in 0% of rolling windows; Sharpe Q4 |
| Tata Small Cap (Regular) | −4.2 pp | −1.0 pp | 23 of 24 | Sharpe 0.08 vs median 0.32; drawdown −32% vs −24% |

The 2 REVIEWs:
- Kotak Contra (Regular): only 3 Regular Contra funds, too few for a fair comparison.
- UNIFI Dynamic Asset Allocation: under 3 years of history.

The three synthetic test statements also gave correct calls: PPFAS at 85–97% → HOLD "already a large share",
with concentration flags.

---

## 9. Owner decisions: defaults applied, all changeable in `config.js → RECOMMENDATION`

1. **Return gaps:** 1.00 pp for equity / hybrid, 0.30 pp for debt.
2. **Consistency:** 65% / 40%.
3. **Concentration:** 20% for one fund, 25% for one fund house (v2.1; was 40%), 15% each for thematic and gold-silver, 30% overseas;
   Mid / Small Cap funds by basket (v2.1): 15 / 10, 25 / 15, 30 / 20 (`fit.capBaskets[].categoryMaxPct`).

4. **Credit quality:** 80% / 60%; unrated above 10% makes Q unknown.
5. **INVEST guard:** 1Y more than 5 pp behind the category median → HOLD (was 2 pp in v1.0).
5a. **Benchmark gap:** 1.00 pp (B −); index-fund tracking limit 1.00 pp a year.
6. **Peer statistic:** the median, not the average (one outlier fund cannot move it).
7. **REVIEW funds:** left unselected, so the advisor must choose before the report.
8. **Sectoral / thematic:** judged against their own index only (v1.1); SELL needs every horizon behind.
9. **Portfolio (`RECOMMENDATION.fit`):** small holding = 0.25 × the average share at the ideal maximum; index funds / ETFs
   at most 3 (2 when the ideal maximum is ≤ 6) and 20% together; overlap from 50%; 25% of the portfolio per review for
   fund-count exits; Large / Mid / Small baskets (§5.3); duplicate gap 0.5 pp; overseas 30%.

---

## 10. Where it lives

| Part | File |
|---|---|
| Thresholds | `calculation-engine/config.js` (RECOMMENDATION) |
| Decision engine (pure, no DOM) | `calculation-engine/portfolio-analyzer/`: `fund-grading.js` (Stage 1), `portfolio-fit.js` (Stage 2), `auto-recommendation.js` (joins them) |
| Peer statistics (daily, after the NAV update) | `data-pipeline/peer_stats.py` → Supabase `stats/peer-stats.json` |
| Website endpoint | `/api/peer-stats?codes=` → `data-pipeline/peer_stats_api.py` |
| Step 3 screen | `app/portfolio-analyzer/screens/recommendation-screen.js` |
| Tests | `tests/engine.test.js` (Auto T1–T17), `data-pipeline/tests/test_peer_stats.py`, `tests/peer-stats-check.html` (T20) |
