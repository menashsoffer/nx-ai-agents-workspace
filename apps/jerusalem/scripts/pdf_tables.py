"""קריאת שורות טבלה מקובצי PDF, עם מספר העמוד שבו הופיעו."""

from collections.abc import Iterator
from pathlib import Path

import pdfplumber


def table_rows(path: Path) -> Iterator[tuple[int, list[str | None]]]:
    """כל שורה בכל טבלה בקובץ, יחד עם מספר העמוד (החל מ-1)."""
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for row in table:
                    yield page_number, row


def tables(path: Path) -> Iterator[tuple[int, list[list[str | None]]]]:
    """כל טבלה בקובץ, יחד עם מספר העמוד, למקרים שבהם שורת הכותרת נחוצה."""
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                yield page_number, table
