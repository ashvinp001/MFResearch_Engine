# TAX_LOGIC.md — CAS Analyzer: STCG / LTCG Module

> Indian MF tax rules, effective 23-Jul-2024 (unchanged through Budget 2026). Keep rates in config.

## Goal
From CAS transactions, compute each fund's capital gains, split STCG/LTCG, in two views:
- **Realised** — from sells already done (tax due this FY).
- **Potential** — if current holdings sold today (planning). Feeds the Sell-timing logic.

## Input (per fund)
`equityPct, currentNav, fmv_2018_01_31, isELSS, lockInOverDate, transactions[{date, type:buy|sell|switch, units, nav}]`
`clientSlabRate` is a separate input. A **switch** = sell source + fresh buy of target (resets target's holding period).

## Step 1 — Classify fund
| Fund type | Condition | LT threshold | STCG | LTCG |
|---|---|---|---|---|
| Equity | equityPct ≥ 65% | 12 mo | 20% | 12.5% above ₹1.25L/FY |
| Specified/debt | ≤35% equity, bought on/after 1-Apr-2023 | none | slab | slab (no LT benefit) |
| Debt (legacy) | ≤35% equity, bought before 1-Apr-2023 | 24 mo | slab | 12.5%, no indexation |
| Hybrid | 35–65% equity | 24 mo | slab | 12.5% |

## Step 2 — Compute (FIFO, oldest lots first)
```
for each sell s (real = actual sells; potential = synthetic sell of all units @ currentNav, today):
    while units_left > 0:
        lot  = oldest lot
        u    = min(units_left, lot.units)
        cost = costBasis(lot, ftype, s.nav)
        gain = (s.nav - cost) * u
        term = (ltThreshold && monthsBetween(lot.date, s.date) >= ltThreshold) ? LONG : SHORT
        record(fund, term, gain, FY(s.date)); consume u

costBasis:  if EQUITY and lot.date < 2018-01-31:  return max(lot.cost, min(fmv_2018_01_31, s.nav))
            else: return lot.cost

equityLTCG_taxable = max(0, sum(equity LONG gains in FY) - 125000)
tax = equityLTCG_taxable*0.125 + equitySTCG*0.20 + debtGains*clientSlabRate
```

## Rules not to miss
- **FIFO** — each SIP instalment is its own lot with its own holding period.
- **Grandfathering** — keep the `min(fmv, sellNav)` term (prevents a fake loss).
- **₹1.25L exemption** — once per FY across all equity LTCG, not per fund.
- **IDCW/dividends** — taxed as income, NOT capital gains; flag separately.
- **ELSS** — locked 3 yrs → always LTCG; potential view marks non-sellable until lockInOverDate.

## Planning hook
For each STCG lot, surface the date it turns LTCG: "Sell now = STCG at 20% vs hold until DD-MMM = LTCG at 12.5%."

## Validation
Reconcile realised figures against the CAMS/KFintech Capital Gains Statement (source of truth). Live computation drives only the what-if view. Final tax confirmed by advisor against client slab — this is a planning estimate, not a filing figure.
