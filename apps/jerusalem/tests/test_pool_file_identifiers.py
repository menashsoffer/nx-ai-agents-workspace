import sys
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from pool_file_identifiers import build, check_digit_ok, scheme_of

SUPPLIERS = ["מזהה ספק מאוחד", "שם ספק / גוף", "ח.פ. / ע.מ. / ת.ז."]
ROWS = ["מזהה ספק מאוחד", "שם ספק / גוף", "שם כפי שמופיע במקור"]


def workbook(suppliers, rows):
    book = Workbook()
    first = book.active
    first.title = "ספקים מאוחדים"
    for line in [SUPPLIERS, *suppliers]:
        first.append(line)
    second = book.create_sheet("כל הרשומות המאומתות")
    for line in [ROWS, *rows]:
        second.append(line)
    return book


class PoolFileIdentifierTests(unittest.TestCase):
    def test_check_digit(self):
        self.assertTrue(check_digit_ok("510986011"))
        self.assertTrue(check_digit_ok("28498319"))
        self.assertFalse(check_digit_ok("510986012"))

    def test_scheme_by_prefix(self):
        self.assertEqual(scheme_of("580010684"), "nonprofit")
        self.assertEqual(scheme_of("510986011"), "company")
        self.assertEqual(scheme_of("550000008"), "company")
        self.assertEqual(scheme_of("028498319"), "personal_id")

    def test_collects_names_and_skips_bad_numbers(self):
        book = workbook(
            [
                ["SUP-1", 'זיו האפט בע"מ', "510986011"],
                ["SUP-2", "זיו האפט BDO", 510986011.0],
                ["SUP-3", "מספר שגוי", "510986012"],
                ["SUP-4", "בלי מספר", None],
                ["SUP-5", "אבי", 28498319],
            ],
            [["SUP-1", 'זיו האפט בע"מ', "BDO"], ["SUP-5", "אבי", "אבי  "]],
        )
        entries, rejected = build(book)
        self.assertEqual(
            entries,
            [
                {
                    "scheme": "company",
                    "value": "510986011",
                    "names": ['זיו האפט בע"מ', "BDO", "זיו האפט BDO"],
                },
                {"scheme": "personal_id", "value": "028498319", "names": ["אבי"]},
            ],
        )
        self.assertEqual(rejected, ["מספר שגוי: 510986012"])


if __name__ == "__main__":
    unittest.main()
