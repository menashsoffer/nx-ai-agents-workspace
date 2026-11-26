import sys
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from pool_file_registries import build

SUPPLIERS = ["מזהה ספק מאוחד", "שם ספק / גוף"]
ROWS = [
    "מזהה ספק מאוחד",
    "ח.פ. / ע.מ. / ת.ז.",
    "שם ספק / גוף",
    "סוג רשומה",
    "מאגר",
    "תחום / תת־תחום",
    "טלפון ראשי",
    "טלפון נוסף",
    "דוא״ל",
    "איש קשר",
    "כתובת",
    "מצב המקור",
    "עמוד מקור",
    "קישור למקור",
    "שם כפי שמופיע במקור",
]
LINK = "https://www.jerusalem.muni.il/media/x/%D7%9E%D7%90%D7%92%D7%A8.pdf"


def workbook(rows):
    book = Workbook()
    first = book.active
    first.title = "ספקים מאוחדים"
    for line in [SUPPLIERS, ["SUP-1", 'ספק מאוחד בע"מ'], ["SUP-2", "ספק שני"]]:
        first.append(line)
    second = book.create_sheet("כל הרשומות המאומתות")
    for line in [ROWS, *rows]:
        second.append(line)
    halls = book.create_sheet("אולמות ומתקנים לאירועים")
    halls.append(["שם אולם / מינהל קהילתי", "מאגר מקור", "קיבולת / תכולה", "הגברה"])
    halls.append(["אולם", "מאגר א", "180 מקומות", None])
    return book


def line(key, name, pool, **extra):
    values = dict.fromkeys(ROWS)
    values.update({"מזהה ספק מאוחד": key, "שם ספק / גוף": name, "מאגר": pool})
    values.update({"סוג רשומה": "ספק / מציע", "קישור למקור": LINK, "מצב המקור": "אומת"})
    values.update(extra)
    return [values[column] for column in ROWS]


class PoolFileRegistryTests(unittest.TestCase):
    def setUp(self):
        self.registries = build(
            workbook(
                [
                    line(
                        "SUP-1",
                        "ספק",
                        "מאגר א",
                        **{
                            "ח.פ. / ע.מ. / ת.ז.": 515301596.0,
                            "תחום / תת־תחום": "תכנון",
                            "טלפון ראשי": "02-1234567",
                            "טלפון נוסף": "123",
                            "דוא״ל": "A@B.co.il; c@d.co.il",
                            "עמוד מקור": 3.0,
                            "שם כפי שמופיע במקור": "ספק (כפי שפורסם)",
                        },
                    ),
                    line("SUP-2", "ספק שני", "מאגר א", **{"ח.פ. / ע.מ. / ת.ז.": "515301597"}),
                    line("HALL", "אולם", "מאגר א", **{"סוג רשומה": "אולם"}),
                    line("SUP-1", "ספק", "קיים באתר"),
                    line("HIST", "ישן", "מאגר ישן", **{"מצב המקור": "גרסה היסטורית"}),
                ]
            ),
            skip={"קיים באתר"},
        )

    def test_one_registry_per_pool_without_skipped_ones(self):
        self.assertEqual([r["name"] for r in self.registries], ["מאגר א", "מאגר ישן"])
        self.assertEqual([r["status"] for r in self.registries], ["unknown", "closed"])
        self.assertEqual(self.registries[0]["file_name"], "מאגר.pdf")

    def test_hall_row_carries_its_details(self):
        rows = self.registries[0]["rows"]
        self.assertEqual([r["key"] for r in rows], ["SUP-1", "SUP-2", "HALL"])
        self.assertEqual(rows[2]["note"], "קיבולת / תכולה: 180 מקומות")

    def test_only_keeps_the_named_registries(self):
        book = workbook([line("SUP-1", "ספק", "מאגר א"), line("SUP-1", "ספק", "מאגר ב")])
        self.assertEqual([r["name"] for r in build(book, only={"מאגר ב"})], ["מאגר ב"])

    def test_row_carries_names_contacts_and_valid_number(self):
        first, second, _ = self.registries[0]["rows"]
        self.assertEqual(
            first,
            {
                "key": "SUP-1",
                "name": 'ספק מאוחד בע"מ',
                "names": ['ספק מאוחד בע"מ', "ספק", "ספק (כפי שפורסם)"],
                "published_name": "ספק (כפי שפורסם)",
                "field": "תכנון",
                "page": 3,
                "phones": ["02-1234567"],
                "emails": ["a@b.co.il", "c@d.co.il"],
                "scheme": "company",
                "value": "515301596",
            },
        )
        self.assertNotIn("value", second)


if __name__ == "__main__":
    unittest.main()
