"""FY2026-27 Excel import rules (pure functions, no database)."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")

import pytest  # noqa: E402
import import_excel_fy2026 as imp  # noqa: E402


@pytest.mark.parametrize("label, expected", [
    ("11th_Science_(Ele&Fish) B English", ("JC", "Class 11", "Junior College", "Bi-Focal", "B")),
    ("11th-Arts A Marathi", ("JC", "Class 11", "Junior College", "Arts", "A")),
    ("12th-Commerce A Marathi", ("JC", "Class 12", "Junior College", "Commerce", "A")),
    ("12th-Science A English", ("JC", "Class 12", "Junior College", "Science", "A")),
    ("1st A English", ("EP", "Class 1", "English Medium", None, "A")),
    ("3rd C English", ("EP", "Class 3", "English Medium", None, "C")),
    ("1st A Semi-English", ("MP", "Class 1", "Semi Medium (Marathi)", None, "A")),
    ("9th B English", ("SEC", "Class 9", "English Medium", None, "B")),
    ("10th A Semi-English", ("SEC", "Class 10", "Semi Medium (Marathi)", None, "A")),
    ("Nursery B English", ("EP", "Nursery", "English Medium", None, "B")),
    ("K.G.I A English", ("EP", "KG I", "English Medium", None, "A")),
    ("K.G.II B English", ("EP", "KG II", "English Medium", None, "B")),
    ("Balwadi A Semi-English", ("MP", "Balwadi", "Semi Medium (Marathi)", None, "A")),
    ("Senior_Shishuvihar A Semi-English", ("MP", "Senior Shishuvihar", "Semi Medium (Marathi)", None, "A")),
])
def test_class_label_maps_to_canonical_fee_head_class(label, expected):
    assert imp.map_label(label) == expected


def test_unknown_label_is_not_mapped():
    assert imp.map_label("Totals") is None


def test_admission_numbers_are_normalised():
    assert imp.adm_norm(4085.0) == "4085"
    assert imp.adm_norm(" s1569 ") == "S1569"
    assert imp.adm_norm(None) is None


def test_name_key_uses_first_and_last_name_only():
    assert imp.name_key("Aachal Bharat Masram") == imp.name_key("Aachal Masram")
    assert imp.name_key("Aditi  Pradip Borwar") == ("aditi", "borwar")


def test_mobile_numbers_are_kept_only_when_valid():
    assert imp.mobile_norm(9876543210) == "9876543210"
    assert imp.mobile_norm("+91 98765 43210") == "9876543210"
    assert imp.mobile_norm("12345") is None


def test_identical_overlap_rows_are_counted_once():
    a = {"adm": "863", "name": "Abhishek Pramod Khapne", "label": "10th A Semi-English", "file": "x", "row": 2}
    b = {"adm": "863", "name": "Abhishek Pramod Khapne", "label": "10th A Semi-English", "file": "y", "row": 102}
    c = {"adm": "864", "name": "Other", "label": "10th A Semi-English", "file": "y", "row": 103}
    out = imp.dedupe([a, b, c])
    assert [r["adm"] for r in out] == ["863", "864"]
    assert out[0]["overlap_files"] == ["y"]


def test_protected_records_are_listed_as_untouchable():
    assert {"9999", "3278", "S1445", "DEMO0001"} == imp.PROTECTED
