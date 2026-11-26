"""ניקוי טקסט שחולץ מקובצי PDF של העירייה. משותף לסקריפטי החילוץ."""

import re


def clean(value):
    """רווחים מרובים לרווח אחד, בלי רווחים בקצוות. None הופך למחרוזת ריקה."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def heb(value):
    """תיקון טקסט עברי שחולץ בסדר חזותי (הפוך).

    כל שורה עם אותיות עבריות מתהפכת, ואז רצפים של אותיות לטיניות, ספרות וסימני דוא"ל
    מוחזרים לכיוונם. זו היוריסטיקה: יש לבדוק את הפלט מול המקור.
    """
    out = []
    for line in str(value or "").splitlines():
        s = clean(line)
        if re.search("[א-ת]", s):
            s = s[::-1]
            s = re.sub(r"[A-Za-z0-9@._+/-]{2,}", lambda m: m.group()[::-1], s)
        out.append(s)
    return clean(" ".join(out))


def compact(value):
    """ניקוי והסרת כל הרווחים, למשל בכתובת דוא"ל שנשברה בין שורות."""
    return clean(value).replace(" ", "")
