/**
 * Prosperr Recommendation conditions — pre-select Invest / Hold / Sell for every fund.
 * The advisor can still change any fund on the Recommendation step.
 *
 * THIS IS THE ONLY PLACE TO EDIT THE CONDITIONS.
 * Rules are checked top to bottom; the FIRST rule whose conditions ALL hold decides the fund.
 * A fund that matches no rule is left unselected for the advisor.
 * A rule with no conditions (`when: []`) matches every fund — put it last as a default.
 *
 * Each rule:  { id, verdict: "invest" | "hold" | "sell", reason, when: [ { metric, op, value } ] }
 *   reason  — short text shown next to the fund, e.g. "Below benchmark by more than 3% (1Y)".
 *   op      — "<", "<=", ">", ">=", "=", "!=", "in", "not in" (in / not in take a list).
 *   metric  — one of (percentages in %, e.g. -12.5):
 *     absoluteReturnPct  gain on the amount invested, %        (CAS)
 *     gainAmount         gain on the amount invested, ₹        (CAS)
 *     currentValue       current value, ₹                      (CAS)
 *     investedValue      amount invested, ₹                    (CAS)
 *     weightPct          share of the portfolio's value, %     (CAS)
 *     return1y / return3y / return5y    fund returns, %        (NAV data)
 *     excess1y / excess3y / excess5y    return minus benchmark (NAV data)
 *     assetClass         "equity" | "debt" | "goldSilver"      (fund data)
 *     category           e.g. "Mid Cap", "Flexi/Multi Cap"     (fund data)
 *   A condition on data that is not available yet (NAV / fund data) never matches.
 *
 * Example (not active):
 *   { id: "sell-laggard", verdict: "sell", reason: "Trails its benchmark by more than 3% over 1 year",
 *     when: [ { metric: "excess1y", op: "<", value: -3 } ] },
 *   { id: "invest-leader", verdict: "invest", reason: "Beats its benchmark by more than 2% over 1 year",
 *     when: [ { metric: "excess1y", op: ">", value: 2 } ] },
 *   { id: "hold-default", verdict: "hold", reason: "In line with expectations", when: [] },
 *
 * TODO (Prosperr): add the final conditions below.
 */

export const RECOMMENDATION_RULES = [];
