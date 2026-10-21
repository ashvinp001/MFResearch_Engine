/**
 * Fund data provider — INTERFACE (Phase 2). The only module that will know where
 * fund-level analytics come from (fund factsheets, NAV history via nav-provider).
 *
 * Input:  a validated portfolio.
 * Output: Promise<FundData | null> — null until the data source is connected.
 *
 * @typedef {Object} FundData
 * @property {string} benchmarkName                         e.g. "Nifty 500"
 * @property {{ equity:number, debt:number, goldSilver:number } | null} composition   % of portfolio
 * @property {{ sector:string, pct:number }[] | null} sectors                         % of equity, ranked
 * @property {{ large:number, mid:number, small:number } | null} marketCap            % of equity
 * @property {{ period:"1Y"|"3Y"|"5Y", portfolio:number, benchmark:number }[] | null} trailingReturns  % p.a.
 * @property {{ alpha:number, beta:number, stdDev:number, sharpe:number,
 *              benchmark:{ beta:number, stdDev:number, sharpe:number } } | null} risk   3-year
 * @property {{ covered:number, total:number } | null} coverage   funds with NAV history
 * @property {number | null} xirr                                  portfolio XIRR, %
 * @property {{ [isin:string]: FundInfo } | null} funds            per-fund analytics
 *
 * @typedef {Object} FundInfo
 * @property {"equity"|"debt"|"goldSilver"} assetClass
 * @property {string} category                                     e.g. "Mid Cap", "Flexi/Multi Cap"
 * @property {string} benchmark                                    e.g. "Nifty Midcap 150 TRI"
 * @property {{ r1y:number|null, r3y:number|null, r5y:number|null }} returns           % (3Y/5Y annualised)
 * @property {{ r1y:number|null, r3y:number|null, r5y:number|null }} benchmarkReturns
 * @property {{ large:number, mid:number, small:number } | null} marketCap               % of the fund's equity
 */

export async function getFundData(portfolio) {
  // TODO (Phase 2): compute from fund holdings data and month-end NAV history.
  return null;
}
