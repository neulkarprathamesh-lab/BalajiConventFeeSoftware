"""Bus Master registration rules and Fuel Expense arithmetic (pure functions, no database)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bus_registry import (  # noqa: E402
    BUS_DISPLAY_ORDER, SCHOOL_BUSES, bus_sort_key, find_existing_bus, full_registration,
    fuel_total, normalize_registration, short_identifier, validate_fuel_numbers,
)


class TestRegistrationNormalization:
    @pytest.mark.parametrize("text", ["MH 40 N426", "MH40N426", "mh-40-n426", "  MH 40  N426 ", "MH40 n426"])
    def test_equivalent_spellings_normalize_to_one_key(self, text):
        assert normalize_registration(text) == "MH40N426"

    def test_short_identifier_strips_common_prefix(self):
        assert short_identifier("MH 40 N426") == "N426"
        assert short_identifier("MH 40 CT5778") == "CT5778"

    def test_short_identifier_of_bare_short_code_is_unchanged(self):
        assert short_identifier("N4978") == "N4978"

    def test_full_registration_is_built_from_the_single_prefix(self):
        assert full_registration("N426") == "MH 40 N426"
        assert full_registration("MH 40 N426") == "MH 40 N426"

    def test_prefix_is_not_stored_as_a_separate_bus_number(self):
        assert "MH40" not in SCHOOL_BUSES
        assert "MH 40" not in SCHOOL_BUSES


class TestSchoolBusList:
    def test_nine_distinct_buses(self):
        assert len(SCHOOL_BUSES) == 9
        assert len(set(SCHOOL_BUSES)) == 9

    def test_n4978_listed_exactly_once(self):
        assert SCHOOL_BUSES.count("N4978") == 1

    def test_display_order_matches_school_order(self):
        assert BUS_DISPLAY_ORDER == ["N426", "N1078", "N4978", "Y7178", "AT478", "BG7978", "BL8279", "CT5578", "CT5778"]

    def test_sorting_follows_display_order_and_puts_unknown_last(self):
        names = ["CT5778", "UNKNOWN9", "N426", "AT478", "N1078"]
        assert sorted(names, key=bus_sort_key) == ["N426", "N1078", "AT478", "CT5778", "UNKNOWN9"]


class TestDuplicatePrevention:
    def test_existing_full_registration_is_matched_in_any_spelling(self):
        existing = [{"id": "x1", "code": "N426", "vehicle_no": "MH 40 N426"}]
        assert find_existing_bus(existing, "N426")["id"] == "x1"
        assert find_existing_bus(existing, "MH40N426")["id"] == "x1"
        assert find_existing_bus(existing, "mh 40 n426")["id"] == "x1"

    def test_missing_bus_returns_none(self):
        existing = [{"id": "x1", "code": "N426", "vehicle_no": "MH 40 N426"}]
        assert find_existing_bus(existing, "N1078") is None

    def test_legacy_record_with_only_short_code_is_reused(self):
        existing = [{"id": "legacy", "code": "N1078", "vehicle_no": None}]
        assert find_existing_bus(existing, "MH 40 N1078")["id"] == "legacy"

    def test_running_insert_loop_never_creates_duplicates(self):
        # Mirrors scripts/add_school_buses.py: each supplied bus is checked against the list
        # including records added earlier in the same run, so a repeated entry is not inserted twice.
        supplied = ["N426", "N1078", "N4978", "N4978", "Y7178"]
        records = []
        for short in supplied:
            if find_existing_bus(records, short) is None:
                records.append({"id": short, "code": short, "vehicle_no": full_registration(short)})
        assert [r["code"] for r in records] == ["N426", "N1078", "N4978", "Y7178"]


class TestFuelArithmetic:
    def test_total_is_litres_times_rate(self):
        assert fuel_total(12.5, 98.4) == 1230.0

    def test_total_rounds_to_paise(self):
        assert fuel_total(3.333, 100) == 333.3

    @pytest.mark.parametrize("litres, rate", [(-1, 90), (10, -90), (0, 90), (10, 0)])
    def test_negative_or_zero_litres_or_rate_rejected(self, litres, rate):
        with pytest.raises(ValueError):
            validate_fuel_numbers(litres, rate)

    def test_missing_litres_or_rate_rejected(self):
        with pytest.raises(ValueError):
            validate_fuel_numbers(None, 90)
        with pytest.raises(ValueError):
            validate_fuel_numbers(10, None)

    def test_negative_odometer_rejected_but_zero_and_missing_allowed(self):
        with pytest.raises(ValueError):
            validate_fuel_numbers(10, 90, -5)
        validate_fuel_numbers(10, 90, 0)
        validate_fuel_numbers(10, 90, None)
