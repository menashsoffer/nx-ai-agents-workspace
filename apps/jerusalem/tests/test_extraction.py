import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
try:
    import extract
    import extract_additional
except ImportError:  # pdfplumber or openpyxl are optional outside the scripts environment
    extract = extract_additional = None


@unittest.skipIf(extract is None, "requires requirements-scripts.txt")
class ExtractionTests(unittest.TestCase):
    def test_computing_rows(self):
        rows = [
            (1, ["02-1234567", "a@b. co", "ןונכת", "17", 'מ"עב תרבח', "1"]),
            (1, ["header", "", "", "", "", "מס"]),
        ]
        with mock.patch.object(extract, "table_rows", return_value=iter(rows)):
            records = extract.computing(Path("."))
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual(r["name"], 'חברת בע"מ')
        self.assertEqual(r["field"], "תכנון")
        self.assertEqual(r["email"], "a@b.co")
        self.assertEqual(r["page"], 1)
        self.assertEqual(r["note"], "קוד תחום: 17")

    def test_phone_from_excel_number(self):
        self.assertEqual(extract.phone_from_cell(21234567 * 10 + 9), "0212345679")
        self.assertEqual(extract.phone_from_cell("02-1"), "02-1")

    def test_transportation_carries_field_header(self):
        rows = [
            (2, ["", "", "", "", "", "הסדנה"]),
            (2, ["x@y.co", "050", "", "ינולפ", "3", ""]),
        ]
        with mock.patch.object(extract_additional, "table_rows", return_value=iter(rows)):
            out = extract_additional.transportation(Path("."))
        self.assertEqual(
            [(r["name"], r["field"], r["source_page"]) for r in out], [("פלוני", "הנדסה", 2)]
        )


if __name__ == "__main__":
    unittest.main()
