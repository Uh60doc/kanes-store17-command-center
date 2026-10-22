#!/usr/bin/env python3
"""Embed the floor catalog into catalog.js.

Reads the product spreadsheet once and writes a browser script. The scanner
does not need the spreadsheet at runtime.

Column mapping (header row of the sheet):
  Product ID (*Dropped) -> sku (digits only). originalSku is kept when the
                           cell text differs. dropped is true when the cell
                           contains (*).
  Vendor                -> groupName (and vendor)
  Vendor SKU            -> vendorSku
  Description           -> description
  Finish                -> finish
  Dimensions            -> dimensions
  Site                  -> site (the store row; the paired Totals row is a
                           duplicate and is not loaded again)
  Store                 -> store
  Locked                -> locked
  Reserved              -> reserved
  Transfers             -> transfers
  Total                 -> total

AS IS: a description whose first non-space character is X or x. That marker
sits beside the item (with a space, or glued on, as in "x Sofa" / "xEnd").
An X later in the name, including a dimension such as 9H x 13W, is not a marker.
The (*) on a product id is the sheet's dropped flag, not AS IS.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "catalog.js"

DEFAULT_CANDIDATES = [
    Path("/home/ubuntu/.cursor/projects/workspace/uploads/BY_Product_ID_f9de.xlsx"),
    Path("/home/ubuntu/.cursor/projects/workspace/uploads/BY_Product_ID_127f.xlsx"),
]


def cell_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def digits_only(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def sheet_as_is(description: str) -> bool:
    text = description.strip()
    return bool(text) and text[0] in ("x", "X")


def load_rows(path: Path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook[workbook.sheetnames[0]]
        rows = list(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()
    if not rows:
        raise ValueError(f"{path} has no rows")
    header = tuple(cell_text(c) for c in rows[0])
    expected = (
        "Product ID (*Dropped)",
        "Vendor",
        "Vendor SKU",
        "Description",
        "Finish",
        "Dimensions",
        "Site",
        "Store",
        "Locked",
        "Reserved",
        "Transfers",
        "Total",
    )
    if header[: len(expected)] != expected:
        raise ValueError(f"Unexpected header in {path}: {header}")
    return rows[1:]


def choose_source(paths: list[Path]) -> tuple[Path, list]:
    errors = []
    for path in paths:
        if not path.is_file():
            errors.append(f"missing {path}")
            continue
        try:
            data = load_rows(path)
        except Exception as exc:  # noqa: BLE001 - try the next upload
            errors.append(f"{path}: {exc}")
            continue
        if not data:
            errors.append(f"{path} is empty")
            continue
        return path, data
    raise SystemExit("No readable catalog spreadsheet.\n" + "\n".join(errors))


def build_items(data_rows):
    chosen: dict[str, dict] = {}
    order: list[str] = []
    skipped_totals = 0
    mismatches = 0
    for row in data_rows:
        if row is None:
            continue
        raw_id = cell_text(row[0] if len(row) > 0 else "")
        if not raw_id:
            continue
        sku = digits_only(raw_id)
        if not sku:
            continue
        site = cell_text(row[6] if len(row) > 6 else "")
        description = cell_text(row[3] if len(row) > 3 else "")
        vendor = cell_text(row[1] if len(row) > 1 else "")
        item = {
            "sku": sku,
            "originalSku": raw_id if raw_id != sku else "",
            "groupName": vendor,
            "description": description,
            "asIs": sheet_as_is(description),
            "dropped": "(*)" in raw_id,
            "vendor": vendor,
            "vendorSku": cell_text(row[2] if len(row) > 2 else ""),
            "finish": cell_text(row[4] if len(row) > 4 else ""),
            "dimensions": cell_text(row[5] if len(row) > 5 else ""),
            "site": site,
            "store": cell_text(row[7] if len(row) > 7 else ""),
            "locked": cell_text(row[8] if len(row) > 8 else ""),
            "reserved": cell_text(row[9] if len(row) > 9 else ""),
            "transfers": cell_text(row[10] if len(row) > 10 else ""),
            "total": cell_text(row[11] if len(row) > 11 else ""),
            "source": "catalog",
        }
        if site == "Totals":
            skipped_totals += 1
            previous = chosen.get(sku)
            if previous is None:
                chosen[sku] = item
                order.append(sku)
            else:
                for key in (
                    "groupName",
                    "description",
                    "vendor",
                    "vendorSku",
                    "finish",
                    "dimensions",
                    "store",
                    "locked",
                    "reserved",
                    "transfers",
                    "total",
                ):
                    if previous[key] != item[key]:
                        mismatches += 1
                        previous.setdefault("totalsMismatch", {})[key] = item[key]
            continue
        previous = chosen.get(sku)
        if previous is None:
            chosen[sku] = item
            order.append(sku)
        elif previous.get("site") == "Totals":
            chosen[sku] = item
        else:
            mismatches += 1
    items = [chosen[sku] for sku in order]
    return items, skipped_totals, mismatches


def main(argv: list[str]) -> None:
    paths = [Path(p) for p in argv[1:]] or list(DEFAULT_CANDIDATES)
    source, data_rows = choose_source(paths)
    items, skipped_totals, mismatches = build_items(data_rows)
    if not items:
        raise SystemExit(f"{source} produced no catalog rows")
    as_is = sum(1 for item in items if item["asIs"])
    payload = {
        "sourceFile": source.name,
        "rowCount": len(items),
        "asIsCount": as_is,
        "skippedTotalsRows": skipped_totals,
        "mismatchedTotalsRows": mismatches,
        "asIsRule": "Description, after trimming, starts with X or x.",
        "columns": {
            "Product ID (*Dropped)": "sku digits only; originalSku if the cell differed; dropped when (*) is present",
            "Vendor": "groupName and vendor",
            "Vendor SKU": "vendorSku",
            "Description": "description",
            "Finish": "finish",
            "Dimensions": "dimensions",
            "Site": "site",
            "Store": "store",
            "Locked": "locked",
            "Reserved": "reserved",
            "Transfers": "transfers",
            "Total": "total",
        },
        "items": items,
    }
    text = "globalThis.FLOOR_CATALOG = " + json.dumps(
        payload, ensure_ascii=True, separators=(",", ":")
    ) + ";\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"source {source}")
    print(f"rows {len(items)}")
    print(f"as_is {as_is}")
    print(f"skipped_totals {skipped_totals}")
    print(f"mismatches {mismatches}")


if __name__ == "__main__":
    main(sys.argv)
