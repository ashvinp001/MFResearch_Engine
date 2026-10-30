# Data pipeline (AMFI · MFAPI → Supabase)

All fund data lives in **Supabase Storage** (private bucket, default `mf-data`). This folder holds only
the code. Connection details and endpoints come from the project's `.env` (template: `.env.example`,
git-ignored, never served by the local server). Python 3.12; one package: `pyarrow`.

```
python -m pip install -r data-pipeline/requirements.txt
python data-pipeline/build_universe.py                 # fund lists -> data/schemes/ + Supabase
python data-pipeline/collect_nav_history.py --check    # test .env, the key and the bucket
python data-pipeline/collect_nav_history.py --limit 10 # trial
python data-pipeline/collect_nav_history.py            # one-time NAV history (resumes if stopped)
python data-pipeline/collect_nav_history.py --verify   # download every file, compare SHA-256
python data-pipeline/daily_update.py                   # the 07:00 job (scheduled)
python data-pipeline/peer_stats.py                     # peer statistics (run by the 07:00 job after the update)
python data-pipeline/collect_benchmarks.py --sheet <workbook.xlsx>   # one-time: benchmark mapping + history
python data-pipeline/benchmark_daily.py                # benchmark update (run by the 07:00 job)
python -m unittest discover -s data-pipeline/tests     # 86 tests
```

## Bucket layout

```
mf-data/
  schemes/regular.json · direct.json · etf.json          fund lists (same as data/schemes/)
  nav/<plan>/<asset class>/<category>/<scheme code>.parquet
       e.g. nav/direct/equity/flexi-cap-fund/122639.parquet
  nav/manifest.json                                     every NAV file: path, first/last date, rows, SHA-256
  reports/universe-latest.json · reports/universe/<date>.json   fund-list run: counts, exclusions, warnings
  reports/nav-collection-latest.json                    rejected, flagged, not-cross-checked schemes
  stats/peer-stats.json                                 daily peer statistics for the Invest / Hold / Sell logic
  holdings/<scheme code>.json                           PulseDB holdings cache (24 h)
```

NAV file: columns `date` (date32) and `nav` (decimal128(24,6), exactly as published), sorted by date,
zstd-compressed; scheme code, name, AMC, plan, category, ISIN and source in the file metadata.

## Fund lists (`build_universe.py`)

| Rule | Detail |
|---|---|
| Sources | AMFI daily NAV file (primary) and Scheme Master (fills blank Plan/Option columns, flags special plans). When **both** leave a scheme without a plan or option (e.g. Motilal Oswal BSE Enhanced Value Index Fund, 150518 / 150519), PulseDB's plan / option for the same scheme code fills it — Growth of a Direct / Regular ("Broker") plan only, never over a value AMFI prints, never duplicating an AMFI-stated line; listed in the report as `plansFromPulse` (20 on 30-Oct-2026). Without Pulse the build runs on AMFI alone |
| Key | AMFI **Scheme Code** (permanent); ISIN check-digit verified |
| Types | Open-ended Equity, Hybrid, Debt, Other (Index, ETF, FoF, Gold/Silver), Solution Oriented. No Life Cycle, close-ended or interval schemes |
| Plans | **Regular and Direct** (separate files); ETFs single-class |
| Option | **Growth only** |
| Active | NAV within 30 days of AMFI's latest date. A code that disappears stays in the list as inactive (the previous lists are the memory) |
| Excluded | IDCW / dividend / bonus, unclaimed and investor-education plans, segregated portfolios, discontinued plans; institutional/retail lines only when the fund has no plain Growth line; duplicates resolved by the Scheme Master. Every excluded code and reason goes to the run report |
| Safety | Columns mapped by header name; a changed header, duplicate code, new category heading, bad ISIN or ISIN shared by two schemes stops the run before anything is written |

## NAV history (`collect_nav_history.py`)

| Step | Detail |
|---|---|
| Source | MFAPI.in full history per scheme code, kept from **01-Jan-2015** |
| Checks | MFAPI's scheme code and ISIN = our list · valid, unique, non-future dates · positive NAV, ≤ 6 decimals · conflicting duplicate dates reject · **every NAV on AMFI's own history report in three windows (late Jun 2015, late Dec 2020, latest ~9 days) must agree, or the scheme is rejected** |
| Left out, reported | rows without a positive NAV (e.g. `0.00000`); a **one-day outlier** — a NAV that jumps > 50% and is back within 5% the next day (publishing error) |
| Kept, flagged | lasting level changes > 30% (e.g. face value ₹10 → ₹1,000), no ISIN at MFAPI, no common check date, active scheme > 7 days behind |
| Storage | built in memory, read back and compared, uploaded; the manifest (saved every 200 schemes) lists only files already in the bucket, so a stopped run resumes safely |

## When MFAPI disagrees with AMFI

If any MFAPI NAV disagrees with AMFI's own history report on a check date (or MFAPI has no data),
the scheme's whole history is taken from **AMFI's NAV history report** instead (`AMFI_NAV_HISTORY_URL`,
narrowed to the scheme's fund house with `&mf=<id>&tp=1`, one calendar year per request). The same
checks apply and the file's metadata records the source. Example: Axis Global Equity Alpha FoF
(MFAPI 10.77020 vs AMFI 10.8981 on 28-Dec-2020) is stored from AMFI.

## Daily update — 07:00 every morning (`daily_update.py`)

| Step | Detail |
|---|---|
| Fund lists | rebuilt from AMFI (new funds added, missing ones kept inactive), uploaded |
| New NAVs | AMFI's history report from the earliest last-stored date (≤ 45 days back) **plus AMFI's daily file** (the report lags a day or two) — official AMFI values, as printed |
| Merge | new days added; a stored NAV that genuinely differs from AMFI's is corrected to AMFI's and flagged (a value AMFI prints with fewer decimals is the same NAV) |
| New schemes | full history (MFAPI, with the AMFI fallback above) |
| Outputs | `nav/manifest.json`, `nav/latest.json` (every fund's latest NAV — the website's current value), `reports/daily/<date>.json`, `reports/daily-latest.json` |
| Self-healing | a missed day is filled by the next run; one scheme's error never stops the rest; exit code 1 when anything failed |
| History report down | if AMFI's history report answers with something else (seen 22-Oct-2026: a web page for every window), the run continues with AMFI's daily file and logs a WARNING per window; days missed while the PC was off are filled once the report (or a corrected `AMFI_NAV_HISTORY_URL`) works again |
| New AMFI heading | an unknown section heading stops the run before anything is written (logged as ERROR); any "Life Cycle Fund with Maturity of N Years" heading is excluded automatically (owner's rule: Life Cycle funds are out) |
| `--reconcile` | re-checks every stored NAV in the window against AMFI (used once after the collection: 1 correction) |
| Awake | `run_daily.ps1` keeps the PC from idling into sleep while it runs (an idle sleep stopped a step on 23-Oct-2026); closing the lid still sleeps it, and the next run completes the day |
| Schedule | Windows Task Scheduler "Prosperr NAV daily update" (`schedule_daily.ps1`; runs as soon as the PC is on if 07:00 was missed; logs in `%LOCALAPPDATA%\Prosperr\logs`) |
| Peer statistics | then `peer_stats.py` (same log): every current fund's 1Y/3Y/5Y, Sharpe, drawdown, rank, E9 quartile and rolling consistency vs its peer group (plan + AMFI category) → `stats/peer-stats.json` (~2 minutes; MF_Calculation_Engine.md E15.5.13) |

## Benchmark data — own bucket `benchmark-data` (`collect_benchmarks.py`, `benchmark_daily.py`)

```
benchmark-data/
  reference/fund-bm-mapping-sheet.json     the owner's Fund - BM Mapping sheet, Regular / Direct Growth rows only
  mapping/funds.json                       scheme code -> benchmarkCode, benchmarkName, declared / alternate benchmark, source
  prices/<ob|ohb|ab|ahb|aub>/<code>.parquet   daily prices: date (date32), value (decimal128(24,6)), name in metadata
  manifest.json · latest.json              every benchmark file (first/last date, rows, SHA-256) · latest price of each
  reports/mapping-latest.json · reports/collection-latest.json · reports/daily/<date>.json
```

| Step | Detail |
|---|---|
| Codes | PulseDB "final benchmark" codes — the series Pulse prices: OB official, OHB official blended, AB alternate, AHB alternate blended, AUB alternate-benchmark series |
| Mapping | Pulse's live mapping (`mf/nav_bm`) for every Regular / Direct Growth scheme in our lists, cross-checked with the owner's sheet: agree → verified; differ → Pulse's (current: funds change benchmarks — 100 of the 118 differences on 22-Oct-2026 were funds whose declared benchmark changed, and the sheet's old codes had no prices) and the difference is reported; only one has it → that one, labelled |
| History | `mf/bm_price_history` daily, two-year windows; Pulse's history starts 21-Sep-2016 |
| Checks | the code returned is the one asked for · dates in the window · positive values, ≤ 6 decimals · no conflicting duplicates · a day without a price (null) left out · a jump > 20% that snaps straight back (one day, or one step within 31 days) is a publishing error, left out · a lasting move > 20% is kept (real: PSU Bank +29.6% 25-Oct-2017, silver −24% 2-Feb-2026) · **cross-checked against Pulse's per-day price list (`mf/bm_data`) on 30-Jun-2016, 31-Dec-2020, 28-Jun-2024 and the latest day — any disagreement rejects the benchmark** (fewer printed decimals = same price) |
| Live mapping | merged over Pulse's last 5 dates with data, each fund from its most recent date — Pulse's list for one day can come back short (22-Oct-2026: hundreds of funds missing), and a fund missing for a day must not fall back to the sheet's older code |
| Daily | mapping refreshed (changes reported) · new benchmarks collected in full · new prices from the same history endpoint (the per-day list also fills weekends / holidays), cross-checked on the latest day, merged (genuine differences corrected and flagged) · a rejected benchmark is listed, not retried |
| Verified | 1Y / 3Y / 5Y computed from the stored series (E2) match Pulse's own trailing returns for 20 benchmarks (1Y exact, 3Y / 5Y within 0.02 pp) |
| Not used | Pulse-made multi-index blends (weights in the name, `benchmark_data.is_composite`): stored, but not used — they do not follow their stated weights (checked 22-Oct-2026; MF_Calculation_Engine.md E15.5.13 6b). `peer_stats.py` gives those funds `benchmark: null` and `benchmarkExcluded` with the reason |
| Our own (SB…) | `benchmark_blends.py`, run inside `benchmark_daily.py`: every Pulse blend that can be built exactly (BAF, Multi Asset, Equity Savings, Balanced Hybrid, …) rebuilt from its components (E7.1), SBGOLD (Gold BeES NAV) for gold funds, SBGS gold+silver 50:50, OB202 for silver funds, S&P 500 for overseas funds. Stored under `prices/sb/`; `mapping/funds.json` carries `rule`, `pulseCode` and `synthetic` (components). A blend that cannot be built exactly is listed in the daily report (`rules.notBuilt`) |
| Website | `GET /api/benchmark-history?codes=OB48,…` (`benchmark_api.py`): daily prices, last 5 years, for the reports' benchmark lines and the blended portfolio benchmark |

**Supabase CDN:** an overwritten object can be served from the CDN's earlier copy for a while (seen 22-Oct-2026),
so `StorageClient.download` (and the server's `/api/latest-nav`) always add a unique query string.

## Website access (no key in the browser)

The local server (`serve.ps1`) reads Supabase / PulseDB with the keys from `.env` and serves only:
`GET /api/latest-nav` (nav/latest.json), `GET /api/nav-history?codes=…` (`nav_api.py`: up to 80
scheme codes, the last 5 years of daily NAVs as exact strings) and `GET /api/fund-holdings?isins=…`
(`holdings_api.py`: each fund's latest PulseDB holdings, classified and looked through by
`pulse_source.py`, cached in Supabase `holdings/<code>.json` for 24 h) and `GET /api/peer-stats?codes=…`
(`peer_stats_api.py`: those funds' peer statistics and their peer groups). The calculation engine computes all
returns and risk from these (MF_Calculation_Engine.md E15.5.8–E15.5.9).

## Files

| File | Purpose |
|---|---|
| `settings.py` | Reads `.env` (environment variables win, for scheduled jobs); never prints secrets |
| `amfi_source.py` | Download and parse AMFI's daily file, Scheme Master and NAV history report |
| `universe_rules.py` | Category map (all 97 AMFI headings), plan / option / special-plan rules, ISIN check digit |
| `build_universe.py` | Classify, resolve duplicates, write the lists, upload lists and report |
| `scheme_lists.py` | Read / check / write / upload the Regular, Direct, ETF lists |
| `mfapi_source.py` | Download one scheme's NAV history from MFAPI.in |
| `nav_history.py` | NAV checks, bucket layout, Parquet build / read |
| `collect_nav_history.py` | One-time collection into Supabase; `--verify` |
| `supabase_storage.py` | Minimal Supabase Storage client (bucket, upload, download, delete) |
| `daily_update.py` | The 07:00 job (lists, AMFI NAVs, manifest, latest NAVs, report); `--reconcile`, `--dry-run` |
| `nav_api.py` | NAV history for the website, called by the local server |
| `pulse_source.py` | PulseDB client (login, holdings) + asset-type classification + fund-of-funds look-through |
| `holdings_api.py` | Fund holdings for the website (Supabase-cached), called by the local server |
| `peer_stats.py` · `peer_stats_api.py` | Daily peer statistics (Recommendation_Logic.md) · served to the website |
| `benchmark_data.py` | Benchmark mapping rules, price checks, bucket layout, Parquet build / read |
| `benchmark_blends.py` | Our own benchmarks and the category rules (gold / silver / overseas / BAF / Multi Asset) |
| `collect_benchmarks.py` · `benchmark_daily.py` | One-time benchmark collection (`--sheet`, `--limit`, `--refresh`) · the daily benchmark update |
| `xlsx_reader.py` | Reads one sheet of an .xlsx (standard library only) — for the owner's reference workbook |
| `run_daily.ps1` · `schedule_daily.ps1` | Run the daily job with a log · register it in Windows Task Scheduler |
| `tests/` | Unit tests for every rule above |
