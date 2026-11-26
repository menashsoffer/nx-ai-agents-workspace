"""The remaining extractors and every script's command line, on small generated inputs."""

import csv
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
try:
    import extract
    import extract_additional
    import pdf_tables
    import pool_file_identifiers
    import pool_file_registries
    import pool_file_venues
    from openpyxl import Workbook
except ImportError:  # pdfplumber or openpyxl are optional outside the scripts environment
    extract = None

from tests.test_pool_file_identifiers import workbook as identifiers_book
from tests.test_pool_file_registries import line as registry_line
from tests.test_pool_file_registries import workbook as registries_book
from tests.test_pool_file_venues import FIRST
from tests.test_pool_file_venues import workbook as venues_book


def run(module, *args):
    """Runs a script's main() with these arguments and returns what it printed."""
    out, err = io.StringIO(), io.StringIO()
    with (
        mock.patch.object(sys, "argv", ["script", *map(str, args)]),
        redirect_stdout(out),
        redirect_stderr(err),
    ):
        module.main()
    return out.getvalue() + err.getvalue()


class FakePdf:
    def __init__(self, pages):
        self.pages = [mock.Mock(extract_tables=mock.Mock(return_value=p)) for p in pages]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@unittest.skipIf(extract is None, "requires requirements-scripts.txt")
class PdfTablesTests(unittest.TestCase):
    def test_rows_and_tables_carry_their_page(self):
        pages = [[[["a"], ["b"]]], [], [[["c"]], [["d"]]]]
        with mock.patch.object(pdf_tables.pdfplumber, "open", return_value=FakePdf(pages)):
            rows = list(pdf_tables.table_rows(Path("x.pdf")))
        self.assertEqual(rows, [(1, ["a"]), (1, ["b"]), (3, ["c"]), (3, ["d"])])
        with mock.patch.object(pdf_tables.pdfplumber, "open", return_value=FakePdf(pages)):
            found = list(pdf_tables.tables(Path("x.pdf")))
        self.assertEqual([page for page, _ in found], [1, 3, 3])


@unittest.skipIf(extract is None, "requires requirements-scripts.txt")
class ExtractTests(unittest.TestCase):
    def test_accounting_marks_fields_by_v_and_skips_short_tables(self):
        header = ["ה", "ד", "ג", "ב", "א"]
        good = ["V", "", "v", "", "", "02-1", "a@b.co", "", "ןולפ", "7"]
        table = [["title"], header, good, ["only", "short"], [*good[:9], "x"]]
        with mock.patch.object(extract, "tables", return_value=iter([(1, [["x"]]), (2, table)])):
            records = extract.accounting(Path("."))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["field"], "ה / ג")
        self.assertEqual(records[0]["page"], 2)

    def test_public_relations_keeps_numbered_rows(self):
        rows = [
            (1, ["", "02-1", "", "a@b. co", "", "ןולפ", "3"]),
            (1, ["", "", "", "", "", "", "x"]),
        ]
        with mock.patch.object(extract, "table_rows", return_value=iter(rows)):
            records = extract.public_relations(Path("."))
        self.assertEqual([r["email"] for r in records], ["a@b.co"])

    def test_human_resources_reads_the_sheet_and_restores_the_phone_zero(self):
        book = Workbook()
        sheet = book.active
        for row in [
            ["שם", "דוא״ל", "טלפון", "", "", "תוקף"],
            ["דנה", "d@x.co", 21234567, "", "", "2027"],
        ]:
            sheet.append(row)
        sheet.append([None, "x", 1, "", "", ""])
        with mock.patch.object(extract.openpyxl, "load_workbook", return_value=book):
            records = extract.human_resources(Path("."))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["note"], "תוקף חוזה כפי שצוין במקור: 2027")

    def test_main_writes_named_records_as_json(self):
        named = extract.record("ספק", "תחום", "מאגר", ("u", 1))
        unnamed = extract.record("", "תחום", "מאגר", ("u", 1))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out" / "records.json"
            with mock.patch.object(extract, "SOURCES", (lambda _src: [named, unnamed],)):
                printed = run(extract, "--sources", tmp, "--output", output)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), [named])
        self.assertIn("1", printed)


@unittest.skipIf(extract is None, "requires requirements-scripts.txt")
class ExtractAdditionalTests(unittest.TestCase):
    def test_city_improvement_takes_the_field_from_the_registry_title(self):
        # The cell holds "מאגר יועצים - תאורה" in reversed visual order.
        title = "הרואת - " + extract_additional.REGISTRY_TITLE_REVERSED
        rows = [
            (1, [title, "", "", "", "", "", ""]),
            (1, ["", "", "02", "a@b.co", "", "ינולפ", "1"]),
            (1, ["short"]),
        ]
        with mock.patch.object(extract_additional, "table_rows", return_value=iter(rows)):
            out = extract_additional.city_improvement(Path("."))
        self.assertEqual([(r["name"], r["field"]) for r in out], [("פלוני", "תאורה")])

    def test_education_and_economists_keep_numbered_rows(self):
        rows = [(1, ["", "ןונכת", "", "ינולפ", "1-2"]), (1, ["02", "", "", "ינומלא", "5"])]
        with mock.patch.object(extract_additional, "table_rows", side_effect=lambda _p: iter(rows)):
            education = extract_additional.education_physical(Path("."))
            economists = extract_additional.economists(Path("."))
        self.assertEqual([r["field"] for r in education], ["תכנון"])
        self.assertEqual([r["name"] for r in economists], ["אלמוני"])

    def test_main_writes_csv_and_refuses_an_empty_result(self):
        kept = extract_additional.row("ספק", "תחום", "מאגר", ("u", 1))
        dropped = extract_additional.row("ספק", "", "מאגר", ("u", 1))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "rows.csv"
            sources = (lambda _src: [kept, dropped],)
            with mock.patch.object(extract_additional, "SOURCES", sources):
                run(extract_additional, "--sources", tmp, "--output", output)
            with output.open(encoding="utf-8") as handle:
                self.assertEqual([r["name"] for r in csv.DictReader(handle)], ["ספק"])
            with (
                mock.patch.object(extract_additional, "SOURCES", (lambda _src: [],)),
                self.assertRaises(SystemExit),
            ):
                run(extract_additional, "--sources", tmp, "--output", output)


@unittest.skipIf(extract is None, "requires requirements-scripts.txt")
class PoolFileCommandLineTests(unittest.TestCase):
    def test_identifiers_writes_numbers_and_lists_what_was_left_out(self):
        book = identifiers_book([["SUP-1", "ספק", "510986011"], ["SUP-2", "שגוי", "510986012"]], [])
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "pool.xlsx", Path(tmp) / "ids.json"
            book.save(source)
            printed = run(pool_file_identifiers, source, output)
            self.assertEqual(len(json.loads(output.read_text(encoding="utf-8"))), 1)
        self.assertIn("1 numbers written, 1 left out", printed)

    def test_registries_writes_one_numbered_file_per_registry(self):
        book = registries_book([registry_line("SUP-1", "ספק", "מאגר א")])
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "pool.xlsx", Path(tmp) / "out"
            book.save(source)
            run(pool_file_registries, source, output, "--start", 5)
            written = json.loads((output / "05.json").read_text(encoding="utf-8"))
        self.assertEqual(written["name"], "מאגר א")

    def test_registries_without_a_halls_sheet_have_no_hall_notes(self):
        book = registries_book([])
        del book["אולמות ומתקנים לאירועים"]
        self.assertEqual(pool_file_registries.hall_notes(book), {})

    def test_venues_writes_halls_and_needs_the_halls_sheet(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "pool.xlsx", Path(tmp) / "halls.json"
            venues_book([FIRST]).save(source)
            printed = run(pool_file_venues, source, output)
            self.assertEqual(len(json.loads(output.read_text(encoding="utf-8"))["rows"]), 1)
        self.assertIn("1 halls written", printed)
        self.assertEqual(pool_file_venues.build(Workbook()), [])


if __name__ == "__main__":
    unittest.main()
