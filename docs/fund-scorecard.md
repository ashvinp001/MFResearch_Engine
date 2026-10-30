# Fund Scorecard

The Fund Scorecard is internal research and is never shown to clients. It rates every fund in a SEBI category from 0 to 100 and ranks the funds.

It sits on the top tab **Fund Scorecard** (`#/fund-scorecard`).

## How a fund is rated

1. **Conditions.** These are the owner's settings. A fund that fails any one of them is listed as **Not rated**, with the reason. It is never scored and never recommended. A fund must meet all of these:
   - at least `minHistoryYears` of NAV history (default 3, allowed 2–10), so new funds and NFOs are never rated. With 2, every fund's risk measures use the last 24 months instead of 36, so the comparison stays like for like; labels then read "(2Y)".
   - its latest NAV no more than `maxNavAgeDays` old (default 7)
   - AUM published and at least `minAumCr` (default ₹500 Cr). AUM is scheme-level, so the same figure applies to Regular and Direct.
   - no one-day NAV move above 25% in the last 6 years; such a move is treated as a data break

   The category itself is ranked only when at least `minPeers` funds qualify (default 5).

2. **Measures.** Each measure is computed by the calculation engine at the fund's latest NAV.

   | Pillar | Measures | Default weight |
   |---|---|---|
   | Returns | 1Y, 3Y, 5Y (E2) | 20% |
   | Risk-adjusted return | Sharpe, Sortino (E12), Information ratio | 20% |
   | Benchmark | Alpha (E12 R4), 3Y excess over the index | 10% |
   | Volatility | Standard deviation, Beta (both: lower is better) | 15% |
   | Downside & capture | Max drawdown, recovery time, Calmar ratio, upside capture, downside capture (R5, R6) | 15% |
   | Consistency | Rolling 3Y at or above the category median; rolling 1Y positive; calendar years in the top half (E9) | 10% |
   | Fund quality | AUM | 10% |

   Further rules for the measures:
   - Risk is measured on the last 36 completed monthly returns.
   - The category median comes from every fund with a current NAV. This is the same peer group the Recommendation Logic uses.
   - Sector and thematic funds are measured against their own index. Every other category uses its SEBI benchmark.

3. **Normalisation.** Each measure becomes a percentile among the rated funds:
   - 0 is the weakest fund and 100 the strongest.
   - For "lower is better" measures the order is reversed.
   - Tied funds share the average position.
   - A measure counts only when at least `minPeers` funds have it.

4. **Score and ranking.**
   - A pillar's score is the average of its measures.
   - The fund's score is the weighted average of its pillars.
   - Funds are ranked by score, and tied scores share a rank.
   - Quartiles follow the owner's E9 ROUNDUP rule.

5. **Alignment with the Recommendation Logic.** Each fund also shows its grade from `gradeFund`, on the same daily peer statistics:
   - STRONG means Recommended to Buy (recommended for fresh investment).
   - MIXED or HOLD means Hold.
   - WEAK means Exit.
   - REVIEW means the advisor decides.

   A strong disagreement is flagged: a top-quartile fund graded WEAK, or a bottom-quartile fund graded STRONG.

6. **Model check.** The page re-rates the category as it stood 3 years ago, using the same method but without AUM, which is not known for that date. It then shows each quartile's return since then.
   - The page reports "Clear edge" only when Q1 beat the category by at least 0.5 pp a year and beat Q4 by at least 1 pp a year.
   - Only surviving funds are counted.

The engine's calculations were verified against the daily peer statistics: on the same date, 1Y, 3Y and 5Y returns, Sharpe, max drawdown and consistency match exactly.

## Index funds

One **Index Funds** card; its sub-categories are the tracked indices, in one compact row grouped as Broad market
(NIFTY 50, BSE Sensex, NIFTY Next 50, NIFTY Midcap 150, NIFTY Smallcap 250, NIFTY 500) · Factor (NIFTY 200
Momentum 30, NIFTY 50 Equal Weight) · Sector (NIFTY Bank, NIFTY IT). The list lives in
`calculation-engine/index-funds.js` (`TRACKED_INDICES`) — the same module the Portfolio Analyzer uses for an index
fund's report group (equity / debt / hybrid by the index it tracks) and its category label ("INDEX FUND · NIFTY 50").

- **Peers:** only funds whose verified benchmark (peer statistics' mapping) is that index.
- **Measures** (`research/index-scorecard.js`): tracking difference 1Y / 3Y p.a. (fund − index, E2; closer to zero is
  better) 40% · tracking error 1Y / 3Y (STDEV.S of daily fund − index returns × √252; lower) 30% · tracking
  consistency (spread of the rolling 1Y tracking difference at the last 12 month-ends; lower) 15% · AUM 15%.
  Tracking difference and tracking error are required; without consistency (a fund under ~2 years) the other pillars
  carry its weight, noted on the fund.
- **Conditions:** ≥ 1 year of NAV history, latest NAV ≤ 7 days old, index history available, AUM ≥ ₹100 Cr, no NAV
  break in the last year, at least 5 eligible funds tracking the index. Fixed method (config `SCORECARD.index`); the
  owner's weight editor applies to the active categories only. No model check — there is no stock-picking edge to test.

## Owner settings

The owner edits the settings in a pop-up (`app/pages/fund-scorecard/settings-dialog.js`) that has a slider and a number for each weight, a live mix bar and a total meter. Save stays disabled until the weights total 100%. The conditions have steppers.


- **Who can change them.** Editing needs both of these:
  - a request from the owner's PC (the one running `serve.ps1`); the server refuses every other computer
  - the **edit password**. The owner created it once on the page (Edit → Create password). It is **final**: the page has no way to change it, and the server refuses changes (`PASSWORD_FINAL` in `scorecard_settings.py`). It can also be set in a real console window with `python data-pipeline/scorecard_settings.py set-password`. Only a salted PBKDF2-SHA256 hash is stored, in `.env` as `SCORECARD_PASSWORD_HASH`. Edit asks for the password first, and the server checks it again on save. After a wrong password the server waits one second before answering. Until a password is set, nobody can edit.

  Every other visitor sees the settings read-only.
- **Validation.** `data-pipeline/scorecard_settings.py` validates every change: known keys only, values in range, and weights totalling 100.
- **Storage.** The saved file is `config/scorecard-settings.json`. The defaults live in `calculation-engine/config.js` as `SCORECARD`.

## Code

| File | Contents |
|---|---|
| `calculation-engine/research/fund-scorecard.js` | the engine: `scoreCategory`, `backtestCategory`, `fundMeasures` |
| `app/pages/fund-scorecard-page.js`, `app/pages/fund-scorecard/scorecard-data.js` | the page |
| `design-system/pages/fund-scorecard.css` | page styles |
| `data-pipeline/fund_metadata.py` (daily, in `run_daily.ps1`), `fund_metadata_api.py` | AUM, inception and manager from PulseDB `mf/metadata`, up to 20 schemes per request |
| `data-pipeline/scorecard_settings.py` | owner settings |

## Planned later layers

- Behaviour in falling markets.
- Portfolio quality from holdings: style drift, concentration, capacity.
- Measures for debt funds (index funds: done, see above).
- Blended benchmarks for hybrid funds.
