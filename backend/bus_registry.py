"""School vehicle registrations and fuel arithmetic shared by the Bus Master, the
bus-registration script and Fuel Expenses.

All school buses share the registration prefix VEHICLE_PREFIX. Only the remaining
part is shown as the bus identifier; the complete registration is stored in full.
"""
import re
from typing import Optional

VEHICLE_PREFIX = "MH 40"

# Display order for bus identifiers in selectors and reports (as supplied by the school).
BUS_DISPLAY_ORDER = ["N426", "N1078", "N4978", "Y7178", "AT478", "BG7978", "BL8279", "CT5578", "CT5778"]

# The nine distinct school buses. MH 40 N4978 was supplied twice and is listed once.
SCHOOL_BUSES = list(BUS_DISPLAY_ORDER)

_PREFIX_KEY = re.sub(r"[^A-Z0-9]", "", VEHICLE_PREFIX.upper())  # "MH40"


def normalize_registration(text: Optional[str]) -> str:
    """Canonical comparison key: upper-case letters and digits only ("MH 40 n-426" -> "MH40N426")."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def short_identifier(registration: Optional[str]) -> str:
    """Bus identifier shown in the UI: the registration with the common prefix removed ("MH 40 N426" -> "N426")."""
    key = normalize_registration(registration)
    if key.startswith(_PREFIX_KEY):
        key = key[len(_PREFIX_KEY):]
    return key


def full_registration(identifier: str) -> str:
    """Complete registration stored internally ("N426" -> "MH 40 N426")."""
    return f"{VEHICLE_PREFIX} {short_identifier(identifier)}"


def bus_sort_key(identifier: str):
    short = short_identifier(identifier)
    if short in BUS_DISPLAY_ORDER:
        return (0, BUS_DISPLAY_ORDER.index(short), short)
    return (1, 0, short)


def find_existing_bus(existing: list, identifier_or_registration: str) -> Optional[dict]:
    """Return the existing bus record that matches this registration, or None.
    A record matches when its normalized full registration, or its normalized short code,
    equals the supplied registration's normalized form."""
    wanted_full = normalize_registration(full_registration(identifier_or_registration))
    wanted_short = short_identifier(identifier_or_registration)
    for rec in existing:
        if normalize_registration(rec.get("vehicle_no")) == wanted_full:
            return rec
        if rec.get("code") and short_identifier(rec.get("code")) == wanted_short and not rec.get("vehicle_no"):
            return rec
    return None


def fuel_total(litres, rate_per_litre) -> float:
    """Total Amount = Litres x Rate per Litre, rounded to paise."""
    return round(float(litres) * float(rate_per_litre), 2)


def validate_fuel_numbers(litres, rate_per_litre, odometer_km=None) -> None:
    """Raises ValueError for missing or invalid fuel figures. Negative values are never accepted."""
    if litres is None or rate_per_litre is None:
        raise ValueError("Quantity (litres) and Rate per Litre are required for fuel expenses.")
    if float(litres) <= 0:
        raise ValueError("Quantity (litres) must be greater than zero.")
    if float(rate_per_litre) <= 0:
        raise ValueError("Rate per litre must be greater than zero.")
    if odometer_km is not None and float(odometer_km) < 0:
        raise ValueError("Odometer reading cannot be negative.")
