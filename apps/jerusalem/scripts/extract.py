"""חילוץ טבלאות ממאגרי היועצים לקובץ JSON לבדיקה אנושית.

הרצה: python3 scripts/extract.py --sources <תיקיית קבצים> --output <קובץ.json>
"""

import argparse
import json
from collections import Counter
from pathlib import Path

import openpyxl
from pdf_tables import table_rows, tables
from source_text import clean, compact, heb

MEDIA = "https://www.jerusalem.muni.il/media/"
UNVERIFIED = "טעון אימות"


def record(name, field, registry, source, **details):
    """רשומה אחת לבדיקה. source הוא זוג (קישור, עמוד)."""
    url, page = source
    return {
        "name": clean(name),
        "field": clean(field),
        "registry": registry,
        "source_url": url,
        "page": page,
        "email": clean(details.get("email")),
        "phone": clean(details.get("phone")),
        "note": details.get("note", ""),
        "status": UNVERIFIED,
    }


def computing(src):
    url = MEDIA + "he0nee24/רשימת-יועצים-לפרסום-באינטרנט.pdf"
    path = src / "רשימת-יועצים-מחשוב ומערכות מידע.pdf"
    return [
        record(
            heb(r[4]),
            heb(r[2]),
            "יועצי מחשוב ומערכות מידע",
            (url, page),
            email=compact(r[1]),
            phone=r[0],
            note="קוד תחום: " + clean(r[3]),
        )
        for page, r in table_rows(path)
        if len(r) == 6 and clean(r[5]).isdigit()
    ]


def accounting(src):
    url = MEDIA + "lbajvgl4/רשימת-הנכללים-במאגר-לפי-קטגוריות.pdf"
    path = src / "מאגר שירותי ראיית חשבון למינהל הכספי.pdf"
    out = []
    for page, table in tables(path):
        if len(table) < 3:
            continue
        headers = [heb(x) for x in table[1][:5]]
        for r in table[2:]:
            if len(r) != 10 or not clean(r[9]).isdigit():
                continue
            fields = [headers[j] for j in range(5) if clean(r[j]).upper() == "V"]
            out.append(
                record(
                    heb(r[8]),
                    " / ".join(fields),
                    "שירותי ראיית חשבון למינהל הכספי",
                    (url, page),
                    email=r[6],
                    phone=r[5],
                )
            )
    return out


def public_relations(src):
    url = MEDIA + "w2megjnt/רשימת-מאגר-משרדי-יחצ-בתוקף-עד-3182027.pdf"
    path = src / "רשימת-מאגר-משרדי-יחצ-בתוקף-עד-3182027.pdf"
    return [
        record(
            heb(r[5]),
            "יחסי ציבור",
            "משרדי יחסי ציבור",
            (url, page),
            email=compact(r[3]),
            phone=r[1],
            note="על פי המסמך: תוקף המאגר עד 31.08.2027",
        )
        for page, r in table_rows(path)
        if len(r) == 7 and clean(r[6]).isdigit()
    ]


def phone_from_cell(value):
    """Excel שומר טלפון כמספר ומוחק את ה-0 בהתחלה. מספר בן 9 ספרות מקבל אותו בחזרה."""
    if isinstance(value, int) and len(str(value)) == 9:
        return "0" + str(value)
    return clean(value)


def human_resources(src):
    url = MEDIA + "1yrhrhfi/מאגר-יועצים-2024.xlsx"
    path = src / "מאגר יועצים- פיתוח המשאב האנושי.xlsx"
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(workbook.active.values)[1:]
    return [
        record(
            row[0],
            "פיתוח המשאב האנושי",
            "פיתוח המשאב האנושי",
            (url, None),
            email=row[1],
            phone=phone_from_cell(row[2]),
            note="תוקף חוזה כפי שצוין במקור: " + clean(row[5]),
        )
        for row in rows
        if row[0]
    ]


SOURCES = (computing, accounting, public_relations, human_resources)


def main():
    parser = argparse.ArgumentParser(description="Extract selected municipal source tables")
    parser.add_argument("--sources", type=Path, required=True, help="Source documents directory")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON file")
    args = parser.parse_args()
    records = [r for extract in SOURCES for r in extract(args.sources) if r["name"]]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(len(records), dict(Counter(r["registry"] for r in records)))


if __name__ == "__main__":
    main()
