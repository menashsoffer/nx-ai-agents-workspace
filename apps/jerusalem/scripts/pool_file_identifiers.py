"""Turn a consolidated pool workbook into input for public.import_identifier_candidates.

Run: python3 scripts/pool_file_identifiers.py <workbook.xlsx> <output.json>

The workbook has a sheet of consolidated suppliers (one row per supplier with its
company, nonprofit or personal number) and a sheet of every source row, which adds the
names each supplier was published under. Numbers with a wrong check digit are left out
and listed on stderr. Every number is only a candidate: the database matches it to a
supplier by name, and a person still accepts it by hand.
"""

import argparse
import json
import re
import sys
from collections import defaultdict

from openpyxl import load_workbook

SUPPLIERS_SHEET = "ספקים מאוחדים"
ROWS_SHEET = "כל הרשומות המאומתות"
SUPPLIER_KEY = "מזהה ספק מאוחד"
NAME = "שם ספק / גוף"
PUBLISHED_NAME = "שם כפי שמופיע במקור"
NUMBER = "ח.פ. / ע.מ. / ת.ז."
COMPANY_PREFIXES = ("50", "51", "52", "53", "54", "55", "56", "57", "59")


def check_digit_ok(number):
    """The Israeli check digit shared by personal, company and nonprofit numbers."""
    total = 0
    for index, char in enumerate(number.zfill(9)):
        digit = int(char) * (1 + index % 2)
        total += digit - 9 if digit > 9 else digit
    return total % 10 == 0


def scheme_of(number):
    padded = number.zfill(9)
    if padded.startswith("58"):
        return "nonprofit"
    if padded.startswith(COMPANY_PREFIXES):
        return "company"
    return "personal_id"


def sheet_rows(workbook, title):
    rows = workbook[title].iter_rows(values_only=True)
    header = [str(cell or "").strip() for cell in next(rows)]
    for values in rows:
        yield dict(zip(header, values, strict=False))


def text(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value or "")).strip()


def published_names(workbook):
    names = defaultdict(list)
    for row in sheet_rows(workbook, ROWS_SHEET):
        key = text(row.get(SUPPLIER_KEY))
        for name in (text(row.get(NAME)), text(row.get(PUBLISHED_NAME))):
            if key and name and name not in names[key]:
                names[key].append(name)
    return names


def build(workbook):
    """Returns (entries, rejected): one entry per number, with every known name."""
    extra = published_names(workbook)
    entries, rejected = {}, []
    for row in sheet_rows(workbook, SUPPLIERS_SHEET):
        number = re.sub(r"\D", "", text(row.get(NUMBER)))
        name = text(row.get(NAME))
        if not number or not name:
            continue
        if len(number) > 9 or not check_digit_ok(number):
            rejected.append(f"{name}: {number}")
            continue
        value = number.zfill(9)
        entry = entries.setdefault(value, {"scheme": scheme_of(value), "value": value, "names": []})
        for known in [name, *extra.get(text(row.get(SUPPLIER_KEY)), [])]:
            if known not in entry["names"]:
                entry["names"].append(known)
    return list(entries.values()), rejected


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook")
    parser.add_argument("output")
    args = parser.parse_args()
    entries, rejected = build(load_workbook(args.workbook, read_only=True, data_only=True))
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(entries, handle, ensure_ascii=False, indent=1)
    print(f"{len(entries)} numbers written, {len(rejected)} left out:", file=sys.stderr)
    for line in rejected:
        print(f"  {line}", file=sys.stderr)


if __name__ == "__main__":
    main()
