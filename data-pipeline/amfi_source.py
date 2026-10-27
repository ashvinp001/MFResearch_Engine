"""AMFI files — download and parse (endpoints from .env, see settings.py).

Input:  AMFI's daily NAV file, Scheme Master CSV and NAV history report.
Output: parse_nav_file(text) -> list[AmfiRow], one per data line, values exactly as printed;
        parse_scheme_master(text) -> {code: MasterRow}; parse_nav_history(text) -> {(code, date): NAV}.

Format (semicolon-delimited, Appendix PA of MF_Platform_Specification.md, updated for the
current 8-column layout): a column-header line, section headings such as
"Open Ended Schemes(Equity Scheme - Large Cap Fund)", AMC-name lines, and data lines.
Columns are mapped by the HEADER line, never by position, so a layout change is detected
instead of silently misread.
"""

from __future__ import annotations

import csv
import io
import re
import time
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta

# Endpoints (settings.py): AMFI_NAV_URL (daily NAV file), AMFI_SCHEME_MASTER_URL (full NAV name,
# category, launch date) and AMFI_NAV_HISTORY_URL (every scheme's NAV per day in a date range).
HISTORY_COLUMNS = {"Scheme Code": "scheme_code", "Net Asset Value": "nav", "Date": "date"}

# Etiquette from the spec: real User-Agent, 90 s timeout, 3 retries with 2 s / 8 s / 30 s backoff.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ProsperrResearch/1.0"
TIMEOUT_SECONDS = 90
RETRY_DELAYS_SECONDS = (2, 8, 30)

# Header names AMFI prints -> our field names. Every one of these must be present.
REQUIRED_COLUMNS = {
    "Scheme Code": "scheme_code",
    "ISIN Div Payout/ ISIN Growth": "isin_growth",
    "ISIN Div Reinvestment": "isin_reinvest",
    "Scheme Name": "scheme_name",
    "Plan": "plan",
    "Option": "option",
    "Net Asset Value": "nav",
    "Date": "date",
}

SECTION_RE = re.compile(r"^(Open Ended|Close Ended|Interval Fund)\s+Schemes?\s*\(", re.IGNORECASE)


class AmfiFormatError(ValueError):
    """The file does not look like the AMFI NAV file we expect — stop, never guess."""


@dataclass(frozen=True)
class AmfiRow:
    scheme_code: int
    isin_growth: str | None
    isin_reinvest: str | None
    scheme_name: str
    plan: str          # as printed ("Regular Plan", "Direct Plan" or "")
    option: str        # as printed ("Growth", "IDCW Option", "" …)
    nav: float | None  # None when AMFI prints N.A. / 0 / blank
    nav_date: date
    section: str       # AMFI section heading, as printed
    amc: str
    nav_text: str = ""  # NAV exactly as printed (the daily update stores this, never the float)


@dataclass(frozen=True)
class MasterRow:
    scheme_code: int
    scheme_name: str
    nav_name: str          # e.g. "Parag Parikh Flexi Cap Fund - Direct Plan - Growth"
    category: str          # e.g. "Equity Scheme - Flexi Cap Fund"
    launch_date: date | None


# Master header -> field. AMFI prints a leading space in " Closure Date" and merges the two ISIN
# headers; only the columns below are used, matched after stripping spaces.
MASTER_COLUMNS = {"Code": "code", "Scheme Name": "scheme_name", "Scheme NAV Name": "nav_name",
                  "Scheme Category": "category", "Launch Date": "launch_date"}


def download(url: str) -> str:
    """Download the file, retrying on failure. An empty body counts as a failure."""
    last_error: Exception | None = None
    for attempt, delay in enumerate((0, *RETRY_DELAYS_SECONDS)):
        if delay:
            time.sleep(delay)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                text = response.read().decode("utf-8", errors="replace")
            if text.strip():
                return text
            last_error = AmfiFormatError("AMFI returned an empty file")
        except Exception as error:  # network errors are retried, then reported
            last_error = error
    raise RuntimeError(f"Could not download {url} after {len(RETRY_DELAYS_SECONDS) + 1} attempts: {last_error}")


def parse_nav_file(text: str) -> list[AmfiRow]:
    rows: list[AmfiRow] = []
    columns: dict[str, int] | None = None
    section: str | None = None
    amc: str | None = None

    for line_number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("Scheme Code"):
            columns = _map_columns(line)
            continue
        if ";" not in line:
            if SECTION_RE.match(line):
                section = line
            else:
                amc = line
            continue
        if columns is None:
            raise AmfiFormatError(f"Line {line_number}: data before the column-header line")
        if section is None or amc is None:
            raise AmfiFormatError(f"Line {line_number}: data before a section heading / AMC name")

        parts = [part.strip() for part in line.split(";")]
        if len(parts) < len(REQUIRED_COLUMNS):
            raise AmfiFormatError(f"Line {line_number}: expected {len(REQUIRED_COLUMNS)} fields, found {len(parts)}")
        value = lambda field: parts[columns[field]]  # noqa: E731 — small local accessor

        code = value("scheme_code")
        if not code.isdigit():
            raise AmfiFormatError(f"Line {line_number}: scheme code {code!r} is not a number")
        rows.append(AmfiRow(
            scheme_code=int(code),
            isin_growth=_isin_or_none(value("isin_growth")),
            isin_reinvest=_isin_or_none(value("isin_reinvest")),
            scheme_name=value("scheme_name"),
            plan=value("plan"),
            option=value("option"),
            nav=_nav_or_none(value("nav")),
            nav_date=_parse_date(value("date"), line_number),
            section=section,
            amc=amc,
            nav_text=value("nav"),
        ))

    if columns is None:
        raise AmfiFormatError("No column-header line found — not an AMFI NAV file")
    if not rows:
        raise AmfiFormatError("The file contains no scheme rows")
    codes = [row.scheme_code for row in rows]
    if len(codes) != len(set(codes)):
        raise AmfiFormatError("The same scheme code appears more than once in the file")
    return rows


def parse_scheme_master(text: str) -> dict[int, MasterRow]:
    """AMFI Scheme Master CSV -> {scheme_code: MasterRow}. Header-mapped; stops on a changed layout."""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    header = [name.strip() for name in next(reader, [])]
    missing = [name for name in MASTER_COLUMNS if name not in header]
    if missing:
        raise AmfiFormatError(f"AMFI Scheme Master header changed — missing columns: {missing}. Found: {header}")
    index = {field: header.index(name) for name, field in MASTER_COLUMNS.items()}
    master: dict[int, MasterRow] = {}
    for line_number, parts in enumerate(reader, start=2):
        if len(parts) < len(header) - 1 or not parts[index["code"]].strip().isdigit():
            continue
        code = int(parts[index["code"]].strip())
        launch = parts[index["launch_date"]].strip()
        try:
            launch_date = datetime.strptime(launch, "%d-%b-%Y").date() if launch else None
        except ValueError:
            launch_date = None
        if code in master:
            raise AmfiFormatError(f"Scheme Master line {line_number}: scheme code {code} appears twice")
        master[code] = MasterRow(code, parts[index["scheme_name"]].strip(), parts[index["nav_name"]].strip(),
                                 parts[index["category"]].strip(), launch_date)
    if not master:
        raise AmfiFormatError("The Scheme Master contains no schemes")
    return master


def nav_history_url(template: str, start: date, end: date) -> str:
    """template = AMFI_NAV_HISTORY_URL with {start} / {end}; AMFI expects dates like 19-Oct-2026."""
    return template.format(start=start.strftime("%d-%b-%Y"), end=end.strftime("%d-%b-%Y"))


AMC_ID_RANGE = range(1, 121)   # AMFI's fund-house ids (mf=…) used by the NAV history report


def amc_history_url(template: str, amc_id: int, start: date, end: date) -> str:
    """The history report narrowed to one fund house (AMFI's mf id) — far smaller than all schemes."""
    return f"{nav_history_url(template, start, end)}&mf={int(amc_id)}&tp=1"


def find_amc_id(template: str, scheme_code: int, on_day: date) -> int | None:
    """AMFI's fund-house id for a scheme: the id whose report for the week up to on_day lists that
    scheme code (a week, so holidays never hide it). None when no id does. One small request per id."""
    week_start = on_day - timedelta(days=6)
    for amc_id in AMC_ID_RANGE:
        try:
            found = parse_nav_history(download(amc_history_url(template, amc_id, week_start, on_day)))
        except (RuntimeError, AmfiFormatError):
            continue  # unused ids return an empty or different page — not this scheme's fund house
        if any(code == scheme_code for code, _ in found):
            return amc_id
    return None


def scheme_history_from_amfi(template: str, amc_id: int, scheme_code: int, start: date, end: date) -> dict[date, str]:
    """One scheme's full daily NAV history from AMFI's own report, fetched a calendar year at a time."""
    points: dict[date, str] = {}
    year = start.year
    while year <= end.year:
        chunk_start, chunk_end = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        for (code, day), nav in parse_nav_history(download(amc_history_url(template, amc_id, chunk_start, chunk_end))).items():
            if code == scheme_code:
                points[day] = nav
        year += 1
    return points


def parse_nav_history(text: str) -> dict[tuple[int, date], str]:
    """AMFI NAV history report -> {(scheme code, date): NAV exactly as printed}. Header-mapped.

    Lines AMFI prints without a usable NAV (N.A., 0, blank) are skipped. The same scheme and date
    printed twice with different NAVs stops the parse (AmfiFormatError) — never guess which is right.
    """
    columns: dict[str, int] | None = None
    points: dict[tuple[int, date], str] = {}
    for line_number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if line.startswith("Scheme Code"):
            names = [name.strip() for name in line.split(";")]
            missing = [name for name in HISTORY_COLUMNS if name not in names]
            if missing:
                raise AmfiFormatError(f"AMFI NAV history header changed — missing {missing}. Found: {names}")
            columns = {field: names.index(name) for name, field in HISTORY_COLUMNS.items()}
            continue
        if ";" not in line:
            continue  # blank lines, section headings, AMC names
        if columns is None:
            raise AmfiFormatError(f"Line {line_number}: data before the column-header line")
        parts = [part.strip() for part in line.split(";")]
        if len(parts) <= max(columns.values()) or not parts[columns["scheme_code"]].isdigit():
            raise AmfiFormatError(f"Line {line_number}: unexpected line {line[:80]!r}")
        nav_text = parts[columns["nav"]]
        if _nav_or_none(nav_text) is None:
            continue
        key = (int(parts[columns["scheme_code"]]), _parse_date(parts[columns["date"]], line_number))
        if points.setdefault(key, nav_text) != nav_text:
            raise AmfiFormatError(f"Line {line_number}: scheme {key[0]} on {key[1]} printed with two NAVs")
    if columns is None:
        raise AmfiFormatError("No column-header line found — not an AMFI NAV history report")
    return points


def _map_columns(header_line: str) -> dict[str, int]:
    names = [name.strip() for name in header_line.split(";")]
    missing = [name for name in REQUIRED_COLUMNS if name not in names]
    if missing:
        raise AmfiFormatError(f"AMFI header changed — missing columns: {missing}. Found: {names}")
    return {field: names.index(name) for name, field in REQUIRED_COLUMNS.items()}


def _isin_or_none(text: str) -> str | None:
    text = text.strip().upper()
    return text if text and text not in {"-", "NA", "N.A."} else None


def _nav_or_none(text: str) -> float | None:
    try:
        nav = float(text.replace(",", ""))
    except ValueError:
        return None
    return nav if nav > 0 else None


def _parse_date(text: str, line_number: int) -> date:
    try:
        return datetime.strptime(text, "%d-%b-%Y").date()
    except ValueError as error:
        raise AmfiFormatError(f"Line {line_number}: unreadable date {text!r}") from error
