"""Turn the halls sheet of the consolidated pool workbook into the input file for
public.import_venue_specs.

Run: python3 scripts/pool_file_venues.py <workbook.xlsx> <output.json>

Each hall row keeps its registry and name, so the database can find the supplier that the
registry load created. Only the hall's own details are kept: no phone, email, contact
person or identifier, which the registry load already handled.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook
from pool_file_identifiers import sheet_rows, text
from pool_file_registries import HALL_NAME, HALL_POOL, HALLS_SHEET

DETAILS = {
    "capacity_text": "קיבולת / תכולה",
    "hall_size": "גודל אולם",
    "stage_size": "גודל במה",
    "screen": "מסך / מקרן",
    "sound": "הגברה",
    "lighting": "תאורה",
}
STATUS = "סטטוס / שנה"


def capacity(value):
    """The number of seats when the text names exactly one number, otherwise None."""
    numbers = re.findall(r"\d[\d,]*", value)
    if len(numbers) != 1:
        return None
    seats = int(seats_digits(numbers[0]))
    return seats if 0 < seats <= 100000 else None


def seats_digits(number):
    """Digits in reading order. Right-to-left cells can store "1,000" as "000,1": a group
    after the first one that is shorter than three digits means the groups are reversed."""
    groups = number.strip(",").split(",")
    if len(groups) > 1 and any(len(group) != 3 for group in groups[1:]):
        groups.reverse()
    return "".join(groups)


def survey_year(value):
    years = re.findall(r"\b(20\d\d)\b", value)
    return int(years[-1]) if years else None


def venue(row):
    details = {key: text(row.get(column)) or None for key, column in DETAILS.items()}
    status = text(row.get(STATUS))
    return {
        "registry": text(row.get(HALL_POOL)),
        "name": text(row.get(HALL_NAME)),
        "capacity": capacity(details["capacity_text"] or ""),
        **details,
        "survey_year": survey_year(status),
    }


def build(workbook):
    if HALLS_SHEET not in workbook.sheetnames:
        return []
    rows = [venue(row) for row in sheet_rows(workbook, HALLS_SHEET)]
    return [row for row in rows if row["registry"] and row["name"]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = build(load_workbook(args.workbook, read_only=True, data_only=True))
    args.output.write_text(
        json.dumps({"rows": rows}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"{len(rows)} halls written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
