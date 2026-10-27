"""Read one worksheet of an .xlsx file (standard library only — no extra dependency).

  sheet_rows(path, sheet_name) -> [ {column letter: text} ]   every row, in order, cells as displayed text
  sheet_names(path) -> [names]

Shared strings, inline strings and plain values are read; formulas give their cached value. Enough for the
reference workbooks the owner shares (e.g. the Fund - BM Mapping sheet); not a general spreadsheet library.
"""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
CELL_REF = re.compile(r"[A-Z]+")


def _workbook(path: Path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS):
        target = rels[s.get(f"{{{NS['r']}}}id")].lstrip("/")
        sheets[s.get("name")] = target if target.startswith("xl/") else f"xl/{target}"
    return z, shared, sheets


def sheet_names(path: Path) -> list[str]:
    return list(_workbook(path)[2])


def sheet_rows(path: Path, sheet_name: str) -> list[dict[str, str]]:
    z, shared, sheets = _workbook(path)
    if sheet_name not in sheets:
        raise KeyError(f"no sheet named {sheet_name!r} (sheets: {', '.join(sheets)})")
    out = []
    for row in ET.fromstring(z.read(sheets[sheet_name])).iter(f"{{{NS['m']}}}row"):
        cells = {}
        for c in row.findall("m:c", NS):
            value = c.find("m:v", NS)
            if c.get("t") == "s" and value is not None:
                text = shared[int(value.text)]
            elif c.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            else:
                text = value.text if value is not None else ""
            cells[CELL_REF.match(c.get("r")).group()] = text or ""
        out.append(cells)
    return out
