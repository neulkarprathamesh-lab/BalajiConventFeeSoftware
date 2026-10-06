"""Bus Master registration rules and Fuel Expense arithmetic (pure functions, no database)."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")  # driver is created lazily; nothing connects
os.environ.setdefault("DB_NAME", "unit_test_db")
os.environ.setdefault("JWT_SECRET", "unit-test-only")

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


# ---------------- Bus fuel expenses: Diesel only, no session, server timestamp ----------------

from fastapi import HTTPException  # noqa: E402
from routers import accounting as acc  # noqa: E402


def _fuel_body(**overrides):
    body = {
        "date": "2026-10-03", "category": "Petrol / Diesel", "description": "Fuel",
        "to_whom": "HP Pump", "who_brought_bill": "Driver", "payment_mode": "cash",
        "bus_route_id": "bus-1", "quantity_litres": "12.5", "rate_per_litre": "98.4", "amount": "999",
        "odometer_km": "45210", "invoice_no": "INV-7",
    }
    body.update(overrides)
    return body


class TestBusFuelDiesel:
    def test_new_bus_fuel_defaults_to_diesel(self):
        doc = acc._validate_expense_body(_fuel_body())
        assert doc["fuel_type"] == "Diesel"

    def test_explicit_diesel_accepted(self):
        assert acc._validate_expense_body(_fuel_body(fuel_type="Diesel"))["fuel_type"] == "Diesel"

    def test_petrol_rejected_for_new_bus_fuel(self):
        with pytest.raises(HTTPException) as e:
            acc._validate_expense_body(_fuel_body(fuel_type="Petrol"))
        assert e.value.status_code == 400

    def test_invalid_fuel_type_rejected(self):
        with pytest.raises(HTTPException):
            acc._validate_expense_body(_fuel_body(fuel_type="CNG"))

    def test_edit_of_historical_petrol_keeps_petrol_when_unchanged(self):
        doc = acc._validate_expense_body(_fuel_body(fuel_type="Petrol"), existing_fuel_type="Petrol")
        assert doc["fuel_type"] == "Petrol"

    def test_edit_cannot_switch_a_diesel_record_to_petrol(self):
        with pytest.raises(HTTPException):
            acc._validate_expense_body(_fuel_body(fuel_type="Petrol"), existing_fuel_type="Diesel")


class TestSessionRemoved:
    def test_session_is_ignored_and_not_stored(self):
        doc = acc._validate_expense_body(_fuel_body(session="Morning"))
        assert "session" not in doc

    def test_session_cannot_be_altered(self):
        assert "session" not in acc._EXPENSE_ALTER_FIELDS


class TestServerTimestamp:
    def test_client_supplied_created_at_is_not_taken_from_request(self):
        doc = acc._validate_expense_body(_fuel_body(created_at="2001-01-01T00:00:00+00:00"))
        assert "created_at" not in doc

    def test_created_at_cannot_be_changed_by_edit(self):
        assert "created_at" not in acc._EXPENSE_ALTER_FIELDS
        assert not any(f.startswith("created") for f in acc._EXPENSE_ALTER_FIELDS)

    def test_server_sets_created_at_on_create(self):
        source = Path(acc.__file__).read_text(encoding="utf-8")
        create_block = source[source.index("async def create_expense"):source.index("# Fields an Alter may change")]
        assert '"created_at": now_iso()' in create_block


class TestFuelTotalsServerSide:
    def test_typed_amount_is_replaced_by_litres_times_rate(self):
        doc = acc._validate_expense_body(_fuel_body(amount="999"))
        assert doc["amount"] == 1230.0

    @pytest.mark.parametrize("field, value", [
        ("quantity_litres", "-3"), ("rate_per_litre", "-98"), ("odometer_km", "-1"),
    ])
    def test_negative_values_rejected(self, field, value):
        with pytest.raises(HTTPException):
            acc._validate_expense_body(_fuel_body(**{field: value}))

    def test_bus_is_required(self):
        with pytest.raises(HTTPException):
            acc._validate_expense_body(_fuel_body(bus_route_id=None))


class TestReportsWithLegacyRecords:
    def _run_report(self, rows, **kwargs):
        async def fake_active(date_from, date_to, extra):
            return rows
        original = acc._active_expenses
        acc._active_expenses = fake_active
        try:
            return asyncio.run(acc.expense_report_bus_fuel(user={"id": "t"}, **kwargs))
        finally:
            acc._active_expenses = original

    def test_totals_unchanged_and_legacy_rows_without_created_at_do_not_break(self):
        rows = [
            {"bus_route_id": "b1", "bus_no": "MH 40 N426", "quantity_litres": 10, "amount": 900,
             "fuel_type": "Diesel", "to_whom": "HP Pump", "created_at": "2026-10-03T10:00:00+00:00"},
            {"bus_route_id": "b1", "bus_no": "MH 40 N426", "quantity_litres": 5, "amount": 500,
             "fuel_type": "Diesel", "to_whom": "HP Pump"},  # legacy: no created_at, no session
        ]
        rep = self._run_report(rows, bus_route_id=None, date_from=None, date_to=None, fuel_type=None, vendor=None)
        assert rep["grand_total_litres"] == 15
        assert rep["grand_total_amount"] == 1400
        assert rep["grand_entries"] == 2
        assert rep["grand_average_rate"] == round(1400 / 15, 2)
        assert rep["by_bus"][0]["bus_short"] == "N426"

    def test_fuel_type_filter_keeps_only_requested_type(self):
        rows = [
            {"bus_no": "MH 40 N426", "quantity_litres": 10, "amount": 900, "fuel_type": "Diesel", "to_whom": "A"},
            {"bus_no": "MH 40 N426", "quantity_litres": 4, "amount": 400, "fuel_type": "Petrol", "to_whom": "A"},
        ]
        rep = self._run_report(rows, bus_route_id=None, date_from=None, date_to=None, fuel_type="Diesel", vendor=None)
        assert rep["grand_entries"] == 1
        assert rep["grand_total_litres"] == 10


# ---------------- Student record version (additive, for future conflict detection) ----------------

from student_version import BASE_VERSION, current_version, next_version, versions_to_backfill  # noqa: E402


class TestStudentVersion:
    def test_legacy_student_without_version_is_version_one(self):
        assert current_version({"id": "s1", "name": "x"}) == BASE_VERSION == 1

    def test_each_change_increments_version(self):
        assert next_version({"id": "s1"}) == 2
        assert next_version({"id": "s1", "version": 4}) == 5

    def test_invalid_stored_version_is_treated_as_base(self):
        assert current_version({"version": "bad"}) == 1
        assert current_version({"version": 0}) == 1

    def test_backfill_targets_only_students_without_version(self):
        students = [{"id": "a"}, {"id": "b", "version": 3}, {"id": "c", "version": None}]
        assert versions_to_backfill(students) == ["a", "c"]

    def test_backfill_leaves_existing_versions_alone(self):
        students = [{"id": "b", "version": 3}]
        assert versions_to_backfill(students) == []
