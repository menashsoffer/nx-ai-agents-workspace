import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from source_text import clean, heb


class SourceTextTests(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean("  a \n  b\t"), "a b")
        self.assertEqual(clean(None), "")

    def test_reverses_visual_hebrew(self):
        self.assertEqual(heb("םוחת"), "תחום")

    def test_keeps_latin_and_numbers_in_order(self):
        self.assertEqual(heb("info@x.co ןופלט 02-1234567"), "02-1234567 טלפון info@x.co")

    def test_multiline_and_non_hebrew(self):
        self.assertEqual(heb("ץעוי\nאריה"), "יועץ הירא")
        self.assertEqual(heb("ABC Ltd"), "ABC Ltd")


if __name__ == "__main__":
    unittest.main()
