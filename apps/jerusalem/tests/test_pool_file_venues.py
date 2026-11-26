import sys
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from pool_file_venues import build, capacity

HEADER = [
    "מזהה אולם",
    "שם אולם / מינהל קהילתי",
    "מאגר מקור",
    "סטטוס / שנה",
    "קיבולת / תכולה",
    "גודל אולם",
    "גודל במה",
    "מסך / מקרן",
    "הגברה",
    "תאורה",
    "טלפון",
    "דוא״ל",
    "איש קשר",
    "ח.פ. / מזהה גוף",
]


FIRST = ["H1", "בית הכרם", "מאגר 2018", "פעיל (2018)"]
CONTACTS = ["02-1", "a@x.test", "דנה", "580010684"]


def workbook(rows):
    book = Workbook()
    sheet = book.active
    sheet.title = "אולמות ומתקנים לאירועים"
    for line in [HEADER, *rows]:
        sheet.append(line)
    return book


class VenuesTest(unittest.TestCase):
    def test_keeps_hall_details_and_drops_contacts(self):
        rows = build(
            workbook(
                [
                    [*FIRST, "1,200 מקומות", "35X25", None, "אין", "יש", None, *CONTACTS],
                    ["H2", None, "מאגר 2018", "פעיל (2018)"],
                ]
            )
        )
        self.assertEqual(len(rows), 1)
        hall = rows[0]
        self.assertEqual(hall["capacity"], 1200)
        self.assertEqual(hall["hall_size"], "35X25")
        self.assertIsNone(hall["stage_size"])
        self.assertEqual(hall["survey_year"], 2018)
        self.assertNotIn("02-1", str(hall))
        self.assertNotIn("580010684", str(hall))

    def test_capacity_only_when_one_number(self):
        self.assertEqual(capacity("180 מקומות"), 180)
        self.assertIsNone(capacity("170-330 מקומות"))
        self.assertIsNone(capacity("ללא"))

    def test_capacity_reads_reversed_thousands(self):
        # Right-to-left cells can store "1,000" as "000,1".
        self.assertEqual(capacity("000,1 מקומות"), 1000)
        self.assertEqual(capacity("341,1 מקומות"), 1341)
        self.assertEqual(capacity("014,11 מקומות"), 11014)
        self.assertEqual(capacity("1,200 מקומות"), 1200)


if __name__ == "__main__":
    unittest.main()
