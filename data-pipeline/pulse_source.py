"""Pulse Labs (PulseDB) — fund holdings, mapped to the engine's holdings contract.

Endpoints (PULSE_BASE_URL from .env): POST partner_login {partner, key} -> data.auth;
POST mf/scheme_holdings_security {auth, scheme_code} -> the latest disclosed holdings:
[{ security, isin_security, holding_perc, mkt_cap_category, sector, rating, coupon, as_on_date, ... }].

  classify(row) -> asset type  (equity | foreignEquity | debt | cash | gold | silver | reit | other | fund)
  normalise(rows) -> [{ name, isin, assetType, sector, marketCap, rating (debt rows, as disclosed), weight }]
  look_through(rows, fetch_by_isin, depth) -> fund-of-funds replaced by their underlying holdings, weighted

Classification (checked in this order; verified on equity, liquid, hybrid, arbitrage, gold-ETF and
fund-of-funds schemes):
  1. ETF / mutual-fund units (sector "ETF Units" / "Mutual Fund Units", or an INF… ISIN) -> fund (look through)
  2. Cash, TREPS, repo, margins, net receivables                                         -> cash
  3. A credit rating, sector "Govt-Sec", or a coupon                                     -> debt
  4. Sector "REIT/InvIT"                                                                  -> reit
  5. mkt_cap_category "Overseas Equity", or a non-Indian ISIN                             -> foreignEquity
  6. mkt_cap_category Large / Mid / Small Cap                                             -> equity with that class
  7. Sector "Commodity": gold / silver by name, else other                                -> gold | silver | other
  8. Any other Indian equity ISIN (INE…, no rating)                                       -> equity, no cap class
  9. Anything else                                                                         -> other
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

TIMEOUT_SECONDS = 90
RETRY_DELAYS_SECONDS = (2, 8)
CAP = {"large cap": "large", "mid cap": "mid", "small cap": "small"}
FUND_UNITS = {"etf units", "mutual fund units"}
CASH_RE = re.compile(r"\bcash\b|treps|tri-?party|repo|cblo|net receivable|net current asset|clearing corporation|margin", re.IGNORECASE)
MAX_LOOK_THROUGH_DEPTH = 2


class PulseError(RuntimeError):
    pass


class PulseClient:
    def __init__(self, base_url: str, partner: str, key: str):
        self.base = base_url.rstrip("/")
        self.partner, self.key, self.auth = partner, key, None

    def _post(self, path: str, body: dict) -> dict:
        last = None
        for delay in (0, *RETRY_DELAYS_SECONDS):
            if delay:
                time.sleep(delay)
            request = urllib.request.Request(f"{self.base}/{path}", data=json.dumps(body).encode(), method="POST",
                                             headers={"Content-Type": "application/json", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code < 500 and error.code != 429:
                    # Pulse explains a refusal in status.root-cause (e.g. "Date range should not exceed…").
                    try:
                        cause = (json.loads(error.read().decode("utf-8", "replace")).get("status") or {}).get("root-cause")
                    except Exception:
                        cause = None
                    raise PulseError(f"{path}: HTTP {error.code}" + (f" ({cause})" if cause else "")) from error
                last = error
            except Exception as error:  # network trouble: retried, then reported
                last = error
        raise PulseError(f"{path}: failed after retries ({last})")

    def login(self) -> None:
        data = self._post("partner_login", {"partner": self.partner, "key": self.key}).get("data") or {}
        if not data.get("auth"):
            raise PulseError("partner_login returned no auth token")
        self.auth = data["auth"]

    def holdings(self, scheme_code: int) -> list[dict]:
        """The scheme's latest disclosed holdings (Pulse picks the latest month when as_on is omitted)."""
        if not self.auth:
            self.login()
        body = self._post("mf/scheme_holdings_security", {"auth": self.auth, "scheme_code": int(scheme_code)})
        data = body.get("data")
        return data if isinstance(data, list) else []

    # ---- benchmarks (codes = Pulse "final_benchmark" codes, e.g. OB48, AUB3) ----
    def _authed(self, path: str, body: dict) -> dict:
        if not self.auth:
            self.login()
        return self._post(path, {"auth": self.auth, **body})

    def bm_price_history(self, code: str, start: str, end: str) -> dict:
        """mf/bm_price_history, daily: {"final_benchmark": code, "nav_history": {date: value}} (≤ 2-year windows)."""
        data = self._authed("mf/bm_price_history", {"benchmark_code": code, "from": start, "to": end, "frequency": "day"}).get("data")
        if isinstance(data, list):  # one object, sometimes wrapped in a list
            data = data[0] if data else None
        return data if isinstance(data, dict) else {}

    def bm_data(self, day: str) -> list[dict]:
        """mf/bm_data: every benchmark's value on one date — [{final_benchmark, benchmark_value}]."""
        data = self._authed("mf/bm_data", {"date": day}).get("data")
        return data if isinstance(data, list) else []

    def nav_bm(self, day: str) -> list[dict]:
        """mf/nav_bm: every scheme's benchmark mapping for one date (all pages of 1000)."""
        out, start = [], 0
        while True:
            data = self._authed("mf/nav_bm", {"date": day, "from": start}).get("data")
            page = data if isinstance(data, list) else []
            out += page
            if len(page) < 1000:
                return out
            start += 1000


def classify(row: dict) -> str:
    sector = (row.get("sector") or "").strip()
    cap = (row.get("mkt_cap_category") or "").strip().lower()
    isin = (row.get("isin_security") or "").strip().upper()
    name = row.get("security") or ""
    if sector.lower() in FUND_UNITS or isin.startswith("INF"):
        return "fund"
    if sector.lower().startswith("cash") or CASH_RE.search(name):
        return "cash"
    if (row.get("rating") or "").strip() or sector.lower() == "govt-sec" or (row.get("coupon") or 0) > 0:
        return "debt"
    if sector.lower() == "reit/invit":
        return "reit"
    if cap == "overseas equity" or (isin and not isin.startswith("IN")):
        return "foreignEquity"
    if cap in CAP:
        return "equity"
    if sector.lower() == "commodity":
        return "gold" if re.search(r"\bgold\b", name, re.IGNORECASE) else "silver" if re.search(r"\bsilver\b", name, re.IGNORECASE) else "other"
    if isin.startswith("INE"):
        return "equity"
    return "other"


def normalise(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        weight = row.get("holding_perc")
        if not isinstance(weight, (int, float)) or weight == 0:
            continue
        kind = classify(row)
        out.append({
            "name": row.get("security") or "", "isin": (row.get("isin_security") or "").strip().upper() or None,
            "assetType": kind, "sector": (row.get("sector") or "").strip() or None,
            "marketCap": CAP.get((row.get("mkt_cap_category") or "").strip().lower()) if kind == "equity" else None,
            "rating": (row.get("rating") or "").strip() or None if kind == "debt" else None,
            "weight": float(weight),
        })
    return out


def look_through(rows: list[dict], fetch_by_isin, depth: int = 0) -> tuple[list[dict], list[str]]:
    """Replace each fund-unit row by that fund's own holdings × its weight. fetch_by_isin(isin) -> normalised
    rows or None. Unresolved fund units stay as 'other' and are reported."""
    out, unresolved = [], []
    for row in rows:
        if row["assetType"] != "fund":
            out.append(row)
            continue
        inner = fetch_by_isin(row["isin"]) if row["isin"] and depth < MAX_LOOK_THROUGH_DEPTH else None
        if not inner:
            out.append({**row, "assetType": "other"})
            unresolved.append(row["name"])
            continue
        inner_rows, inner_unresolved = look_through(inner, fetch_by_isin, depth + 1)
        unresolved += inner_unresolved
        total = sum(r["weight"] for r in inner_rows) or 100.0
        out += [{**r, "weight": row["weight"] * r["weight"] / total} for r in inner_rows]
    return out, unresolved
