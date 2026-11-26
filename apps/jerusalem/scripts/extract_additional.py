"""חילוץ טבלאות ממאגרים נוספים לקובץ CSV לבדיקה אנושית.

הרצה: python3 scripts/extract_additional.py --sources <תיקיית קבצים> --output <קובץ.csv>
"""

import argparse
import csv
import re
from collections import Counter
from pathlib import Path

from pdf_tables import table_rows
from source_text import clean, compact, heb

MEDIA = "https://www.jerusalem.muni.il/media/"
NOTE = "חולץ אוטומטית – יש לאמת מול המקור"
# הכותרות האלה מופיעות בקובץ בסדר חזותי הפוך, כפי שהן נקראות לפני heb()
FIELD_HEADER_REVERSED = "םוחת"
REGISTRY_TITLE_REVERSED = "םיצעוי רגאמ"


def row(name, field, registry, source, **contact):
    """שורה אחת לבדיקה. source הוא זוג (קישור, עמוד)."""
    url, page = source
    return {
        "name": clean(name),
        "field": clean(field),
        "registry": registry,
        "source_url": url,
        "source_page": page,
        "email": clean(contact.get("email")),
        "phone": clean(contact.get("phone")),
        "note": NOTE,
        "review_status": "needs_review",
    }


def transportation(src):
    """התחום מופיע כשורת כותרת לפני הספקים שלו, ולכן נשמר בין השורות."""
    url = MEDIA + "3sydompm/מאגר-יועצים-מאושר-לשנת-2025-2027.pdf"
    path = src / "מאגר-יועצים-מאושר-תחבורה ופיתוח תשתיות-לשנת-2025-2027.pdf"
    out, field = [], ""
    for page, r in table_rows(path):
        if len(r) != 6:
            continue
        if clean(r[5]) and not clean(r[3]) and FIELD_HEADER_REVERSED not in clean(r[5]):
            field = heb(r[5])
        if clean(r[4]).isdigit() and clean(r[3]):
            registry = "תחבורה ופיתוח תשתיות"
            out.append(
                row(heb(r[3]), field, registry, (url, page), email=compact(r[0]), phone=r[1])
            )
    return out


def field_from_title(cells, current):
    """כותרת מאגר בתוך השורה מגדירה את התחום של השורות הבאות."""
    for cell in cells:
        if cell and REGISTRY_TITLE_REVERSED in cell:
            current = heb(cell).split(" - ", 1)[-1]
    return current


def city_improvement(src):
    url = MEDIA + "0xrfvbbn/מאגר-יועצים-אגף-שיפור-פני-העיר.pdf"
    path = src / "מאגר-יועצים-אגף-שיפור-פני-העיר.pdf"
    out, field = [], ""
    for page, r in table_rows(path):
        if len(r) != 7:
            continue
        field = field_from_title(r, field)
        if clean(r[6]).isdigit() and clean(r[5]):
            registry = "אגף שיפור פני העיר"
            out.append(
                row(heb(r[5]), field, registry, (url, page), email=compact(r[3]), phone=r[2])
            )
    return out


def education_physical(src):
    url = MEDIA + "tecnwz4z/מאגר-2024.pdf"
    path = src / "מאגר יועצים תחומים פיזיים מינהל החינוך-2024.pdf"
    return [
        row(heb(r[3]), heb(r[1]), "תחומים פיזיים מינהל החינוך", (url, page))
        for page, r in table_rows(path)
        if len(r) == 5 and re.fullmatch(r"[0-9-]+", clean(r[4])) and clean(r[3]) and clean(r[1])
    ]


def economists(src):
    url = MEDIA + "tcbhbl5i/רשימת-יועצים-כלכלנים-2023.pdf"
    path = src / "מאגר כלכלנים- ייעוץ כלכלי.pdf"
    return [
        row(heb(r[3]), "ייעוץ כלכלי", "מאגר כלכלנים", (url, page), phone=r[0])
        for page, r in table_rows(path)
        if len(r) == 5 and clean(r[4]).isdigit()
    ]


SOURCES = (transportation, city_improvement, education_physical, economists)


def main():
    parser = argparse.ArgumentParser(description="Extract additional municipal source tables")
    parser.add_argument("--sources", type=Path, required=True, help="Source documents directory")
    parser.add_argument("--output", type=Path, required=True, help="Output CSV file")
    args = parser.parse_args()
    rows = [r for extract in SOURCES for r in extract(args.sources) if r["name"] and r["field"]]
    if not rows:
        raise SystemExit("No rows were extracted. Check the source directory and file names.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print("total", len(rows), dict(Counter(r["registry"] for r in rows)))
    for registry in sorted({r["registry"] for r in rows}):
        print(registry, [(r["name"], r["field"]) for r in rows if r["registry"] == registry][:3])


if __name__ == "__main__":
    main()
