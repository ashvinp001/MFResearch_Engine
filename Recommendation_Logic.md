# Prosperr — Invest / Hold / Sell Recommendation Logic · v1.4

> **v1.4 (23-Oct-2026, owner's decisions):** Stage 2 now judges each fund **inside this portfolio** (§5.2):
> - **Too many funds for the portfolio's size** (its own Diversification range) → the weakest Hold funds exit,
>   small holdings first, until the count is back in range. A small holding is relative to the portfolio, not fixed.
> - **Index funds / ETFs**: at most 2 (portfolios whose ideal maximum is ≤ 6 funds) or 3 → the extra ones exit.
> - **Sectoral / thematic, gold / silver, overseas above 15%** → the weaker fund of that group exits; a fund house
>   above 40% or a theme still above its limit takes no new money (INVEST → HOLD).
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
2. **No single-metric SELL.** SELL needs persistent under-performance (pillar R, §3) **plus** at least one
   independent pillar that confirms it.
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
| **WEAK** | R − **and** at least one of K, C, S, B is − |
| **STRONG** | R + **and** C + **and** (K + or S +). If C is unknown: R + **and** K + **and** S + |
| **STRONG** (v1.1) | R + **and** B + **and** none of K, C, S is − — ahead of both the category and its own benchmark on 3Y and 5Y |
| **WEAK** (v1.1, "in line" but behind both) | behind the category median on 3Y and 5Y (any margin) **and** B − **and** none of K, C, S is + |
| **MIXED** | everything else: the evidence genuinely disagrees. R − with nothing confirming it is MIXED with the note "watch" |

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
| Active sectoral / thematic fund (benchmark is a sector index) | **SELL** if the fund itself is also behind the market on 3Y and 5Y; **HOLD** if the fund is ahead of the market | the own-index rule above (§4.2) | §4.2 |
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
- R+ and K+ → STRONG
- R− and K− → WEAK
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
  - **WEAK** = R− and (K− or S− or Q− or B−); or behind the category on 3Y and 5Y and B−, nothing positive
  - **STRONG** = R+ and (K+ or S+ or B+), with none of S, Q, B −
  - **MIXED** otherwise

Arbitrage (§4.4) uses R, K and B the same way.

### 4.6 Index funds / ETFs, and HOLD by type
**Index funds and ETFs** are judged on tracking: fund 3Y return − its index's 3Y return.
- within −1.00 pp a year (or ahead) → **INVEST**
- further behind → **HOLD** ("trailing its index")
- under 3 years, or no benchmark data (ETFs are not in the benchmark mapping) → **HOLD**
- two index funds on the **same index**: the closer tracker gets INVEST, the other HOLD ("consider consolidating").

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
| Latest NAV more than 7 days older than the peer data | stale data |
| No peer statistics for the fund | NAV not current or not stored |
| Debt credit-event guard (§4.5), weak sectoral fund (§4.2) | as stated |
| Weak ELSS with no transaction history in the CAS | lock-in cannot be determined |

---

## 5. Stage 2: portfolio level

Stage 2 runs in this order. Each condition is defined once (`auto-recommendation.js`); the Suggestion Box (§5.3)
reads the same results and adds no rule of its own.

### 5.1 Fund against fund (tie-breaks)

1. **INVEST blockers.** A STRONG fund is moved to **HOLD**:
   - when it is already **more than 20%** of the portfolio, or
   - when its 1Y return trails the category median by **more than 5 pp** — a sharp fall ("hold until it recovers").
2. **Several funds in one AMFI category (any plan).**
   - Rank them: STRONG before MIXED, then by e3 + e5 (e3 + e1 when there is no 5Y figure).
   - The **best STRONG fund without a blocker gets INVEST**. If the top fund is blocked, the next STRONG
     fund takes its place.
   - Other STRONG funds → **HOLD**: "Strong, but X ranks higher".
   - Every other fund in the category gets the note "Same category as X — consider consolidating; new money
     goes to Y".
   - **Weakest duplicate (owner's rule, v1.1):** a non-leading MIXED fund that is behind its category median
     **and** its own benchmark on both horizons (3Y and 5Y; 3Y and 1Y without 5Y), by any margin → **SELL**
     ("consolidate into the stronger fund"). A fund ahead of either yardstick on either horizon is kept.
   - A STRONG fund is never sold for being second best.
   - Index funds and sectoral / thematic funds are not ranked here (§4.2, §4.6).
3. **WEAK ELSS** with locked units → **HOLD**: "N units in the ELSS lock-in (all free by DD-MMM-YYYY) —
   review then". Fully free units → SELL as usual.
4. **Regular and Direct plans** are both recommended: no switch note (v1.2, owner's decision). Each plan is
   compared with its own plan's peers.
5. **Overlap between funds** (PulseDB holdings): see v1.3 at the top — **≥ 50%** overlap (v1.4) between two
   active equity funds acts on the weaker one.

### 5.2 Fund inside this portfolio — portfolio fit (v1.4)

**Limits, all from this portfolio:**

| Limit | Value |
|---|---|
| Ideal fund count | the Diversification range for the portfolio's value: < ₹5L 2–4 · ₹5L–25L 3–6 · ₹25L–1Cr 4–8 · ₹1Cr–5Cr 5–10 · > ₹5Cr 6–13. Funds counted by ISIN, as the report does |
| Small holding | below ¼ of the average fund share at the ideal maximum (100 ÷ max × 0.25): e.g. max 8 → 3.1%, max 4 → 6.25% |
| Index funds / ETFs | at most 2 when the ideal maximum is ≤ 6 funds, else 3 (gold / silver ETFs are counted under gold / silver) |
| Themes | sectoral / thematic (incl. sector index funds / ETFs), gold / silver, overseas: 15% each |
| Fund house | 40% |

**Exits.** While a limit (fund count, index funds / ETFs, a theme) is exceeded, one fund at a time exits:
- **Who can exit:** a fund whose call is HOLD. A STRONG fund only when it is a small holding *and* a duplicate of
  the STRONG fund taking new money in its category / index / overlap pair.
- **Never:** the STRONG fund that takes the new money in its category, index or overlap pair; a STRONG fund above
  20%; an ELSS fund with units in the lock-in (or a lock-in that cannot be told); the last hybrid, debt or gold
  fund; for a theme / index-fund limit, the strongest fund of that group; INVEST and REVIEW funds.
- **Which first:** the candidate that relieves the most open limits (so the fewest funds are sold); then a small
  holding → a duplicate of a STRONG fund → a fund of a fund house above 40% → the weakest (grade, then 3Y + 5Y
  lead over its category or benchmark) → the smallest.
- **Stop:** as soon as every limit is met, or no candidate is left (the Suggestion Box then still says the
  portfolio is above its range).
- **Reason shown:** "Portfolio fit — the portfolio holds 29 funds where 4–8 suit its size. This fund: a small holding
  (0.6% of the portfolio); HDFC Nifty 50 Index Fund already covers the same index — exit and move the money to HDFC
  Nifty 50 Index Fund. On its own: …" The PDF says the fund is exited to consolidate — never that it trails its
  peers unless the logic graded it WEAK.

**No new money.** After the exits, an INVEST in a fund house above 40%, or in a theme still above its limit,
becomes HOLD ("no new money to this fund house" / "into them").

### 5.3 Suggestion Box (screen and PDF, end of Section 05)

One line per point, phrased so it stays true when the advisor changes a call:
- the fund count against the ideal range (when above it)
- index funds / ETFs above their limit
- each fund house above 40%; each theme above 15% (with "marked for exit" or "no new money")
- each fund above 20% (index funds / ETFs exempt)
- each overlap pair acted on
- the same fund in several folios (merge through the registrar — no sale) or in both plans (consolidate)

---

## 6. Final mapping to the three buttons

| Grade | Situation | Pre-selected |
|---|---|---|
| STRONG | best investable fund in its category | **INVEST** |
| STRONG | not the best / above 20% / 1Y more than 5 pp behind / fund house or theme above its limit | **HOLD** |
| MIXED, or a HOLD type (§4.6) | — | **HOLD** |
| any HOLD (STRONG only if a small duplicate) | portfolio fit exit (§5.2) | **SELL** |
| WEAK | units free | **SELL** |
| WEAK | ELSS units locked | **HOLD** |
| REVIEW | — | *nothing pre-selected*: the reason is shown and the advisor chooses |

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
| P7 | Portfolio within every limit | Stage 2b changes nothing | ✅ |
| P8 | Suggestion Box: folios, both plans, overlap | listed, independent of the final calls | ✅ |
| P9 | 400 random portfolios (1–30 funds, every value band) | no large STRONG fund, locked ELSS or last gold fund exited; no exit without an open limit; count exits stop at the ideal maximum | ✅ |
| P10 | Overlap 55% / 45% | acted on / not | ✅ |
| P11 | PDF Sell commentary | "trails its peers" only for a fund graded WEAK; portfolio-fit exits say "consolidate" | ✅ |

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
3. **Concentration:** 20% for one fund, 40% for one fund house, 15% each for thematic, gold-silver and overseas.
4. **Credit quality:** 80% / 60%; unrated above 10% makes Q unknown.
5. **INVEST guard:** 1Y more than 5 pp behind the category median → HOLD (was 2 pp in v1.0).
5a. **Benchmark gap:** 1.00 pp (B −); index-fund tracking limit 1.00 pp a year.
6. **Peer statistic:** the median, not the average (one outlier fund cannot move it).
7. **REVIEW funds:** left unselected, so the advisor must choose before the report.
8. **Sectoral / thematic:** judged against their own index only (v1.1); SELL needs every horizon behind.
9. **Portfolio fit (v1.4, `RECOMMENDATION.fit`):** small holding = 0.25 × the average share at the ideal maximum;
   index funds / ETFs at most 3 (2 when the ideal maximum is ≤ 6); overlap from 50%. Risk profile / horizon fit is
   deferred to the Financial Plan.

---

## 10. Where it lives

| Part | File |
|---|---|
| Thresholds | `calculation-engine/config.js` (RECOMMENDATION) |
| Decision engine (pure, no DOM) | `calculation-engine/portfolio-analyzer/auto-recommendation.js` |
| Peer statistics (daily, after the NAV update) | `data-pipeline/peer_stats.py` → Supabase `stats/peer-stats.json` |
| Website endpoint | `/api/peer-stats?codes=` → `data-pipeline/peer_stats_api.py` |
| Step 3 screen | `app/portfolio-analyzer/screens/recommendation-screen.js` |
| Tests | `tests/engine.test.js` (Auto T1–T17), `data-pipeline/tests/test_peer_stats.py`, `tests/peer-stats-check.html` (T20) |
