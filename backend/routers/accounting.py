"""Accounting module — Expenses (incl. bus-wise Petrol/Diesel tracking) and Bill Entry.

Both are intentionally independent of the existing student/fee/receipt system:
- Expense Entry records an actual payment the school made (own numbering,
  own collection, own audit trail). It never touches students, fee_details,
  fee_structures, receipts, or receipt numbering.
- Bill Entry records a bill/invoice document received by the school (a
  separate concept from an actual payment). It never auto-creates an Expense
  and never touches Fee Collection or student balances.

Both reuse the app's existing patterns: atomic `db.counters` numbering,
`audit()` logging, `require_roles` RBAC, and `re.escape()`-safe search.
"""
import re
from datetime import date as _date
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from core import (
    db, audit, gen_id, get_current_user, require_roles, now_iso,
    next_expense_number, next_bill_number,
)

router = APIRouter(prefix="/api", tags=["accounting"])

FINANCE_ROLES = ("administrator", "manager", "accountant", "cashier")
VOID_ROLES = ("administrator", "manager")

DEFAULT_EXPENSE_CATEGORIES = [
    "Petrol / Diesel", "Stationery", "Electricity", "Maintenance / Repairs",
    "Cleaning", "Printing", "Office Expenses", "Staff-related Expenses", "Other",
]
FUEL_CATEGORY = "Petrol / Diesel"
OTHER_CATEGORY = "Other"
PAYMENT_MODES = ("cash", "upi", "bank_cheque")


async def _seed_expense_categories_if_empty():
    if await db.expense_categories.count_documents({}) > 0:
        return
    now = now_iso()
    for i, name in enumerate(DEFAULT_EXPENSE_CATEGORIES):
        await db.expense_categories.insert_one({
            "id": gen_id(), "name": name, "display_order": i * 10,
            "active": True, "created_at": now,
        })


def _current_academic_year() -> str:
    # Matches the rest of the app's "2026-27"-style default used wherever an
    # explicit academic_year isn't supplied by the caller.
    return "2026-27"


# ============================================================================
# Expense Categories (admin-manageable master)
# ============================================================================
@router.get("/expense-categories")
async def list_expense_categories(include_inactive: bool = False, user=Depends(get_current_user)):
    await _seed_expense_categories_if_empty()
    q: Dict[str, Any] = {} if include_inactive else {"active": {"$ne": False}}
    return await db.expense_categories.find(q, {"_id": 0}).sort("display_order", 1).to_list(200)


@router.post("/expense-categories")
async def create_expense_category(body: Dict[str, Any], user=Depends(require_roles("administrator"))):
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Category name is required")
    if await db.expense_categories.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise HTTPException(400, f"Category '{name}' already exists")
    cid = gen_id()
    n = await db.expense_categories.count_documents({})
    doc = {"id": cid, "name": name, "display_order": (n + 1) * 10, "active": True, "created_at": now_iso()}
    await db.expense_categories.insert_one(doc)
    await audit(user, "create", "expense_category", cid, {"name": name})
    return {k: v for k, v in doc.items() if k != "_id"}


@router.patch("/expense-categories/{cid}")
async def update_expense_category(cid: str, body: Dict[str, Any], user=Depends(require_roles("administrator"))):
    existing = await db.expense_categories.find_one({"id": cid})
    if not existing:
        raise HTTPException(404, "Not found")
    upd: Dict[str, Any] = {}
    if "name" in body and str(body["name"]).strip():
        upd["name"] = str(body["name"]).strip()
    if "active" in body:
        upd["active"] = bool(body["active"])
    if not upd:
        raise HTTPException(400, "Nothing to update")
    await db.expense_categories.update_one({"id": cid}, {"$set": upd})
    await audit(user, "update", "expense_category", cid, {"before": {k: existing.get(k) for k in upd}, "after": upd})
    return await db.expense_categories.find_one({"id": cid}, {"_id": 0})


# ============================================================================
# Expenses
# ============================================================================
def _validate_expense_body(body: Dict[str, Any]) -> Dict[str, Any]:
    category = str(body.get("category") or "").strip()
    description = str(body.get("description") or "").strip()
    to_whom = str(body.get("to_whom") or "").strip()
    who_brought_bill = str(body.get("who_brought_bill") or "").strip()
    payment_mode = str(body.get("payment_mode") or "").strip().lower()
    expense_date = str(body.get("date") or "").strip() or _date.today().isoformat()

    if not category:
        raise HTTPException(400, "Expense Category is required")
    if not description:
        raise HTTPException(400, "Description / Purpose is required")
    if not to_whom:
        raise HTTPException(400, "'To Whom' is required")
    if not who_brought_bill:
        raise HTTPException(400, "'Who Brought the Bill' is required")
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Amount must be a number")
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    if payment_mode not in PAYMENT_MODES:
        raise HTTPException(400, f"payment_mode must be one of: {', '.join(PAYMENT_MODES)}")

    cheque_no = str(body.get("cheque_no") or "").strip() or None
    if payment_mode == "bank_cheque" and not cheque_no:
        raise HTTPException(400, "Cheque No. is required for Bank / Cheque payments")
    if payment_mode != "bank_cheque":
        cheque_no = None  # never stored/required for Cash or UPI

    # "Other" requires the user to name the actual expense. The internal
    # `category` classification is always preserved as "Other" (never
    # overwritten) so category-wise aggregation/reporting stays correct;
    # `category_display` is what tables/registers/the Daily Fee & Expense
    # report actually show — the custom name for "Other", the plain category
    # name for everything else. Never shown/stored/required for any other category.
    custom_expense_name = None
    if category == OTHER_CATEGORY:
        custom_expense_name = str(body.get("custom_expense_name") or "").strip()
        if not custom_expense_name:
            raise HTTPException(400, "Expense Name is required when Category is 'Other'")

    doc = {
        "date": expense_date, "category": category,
        "custom_expense_name": custom_expense_name,
        "category_display": custom_expense_name if category == OTHER_CATEGORY else category,
        "description": description,
        "to_whom": to_whom, "who_brought_bill": who_brought_bill,
        "amount": amount, "payment_mode": payment_mode, "cheque_no": cheque_no,
        "remarks": (str(body.get("remarks")).strip() or None) if body.get("remarks") else None,
        "bus_route_id": None, "bus_no": None, "session": None,
        "fuel_type": None, "quantity_litres": None, "rate_per_litre": None,
    }

    # Petrol/Diesel special handling — only relevant when the category matches;
    # never required/shown for any other category.
    if category == FUEL_CATEGORY:
        bus_route_id = body.get("bus_route_id")
        session = str(body.get("session") or "").strip() or None
        fuel_type = str(body.get("fuel_type") or "").strip() or None
        if fuel_type and fuel_type not in ("Petrol", "Diesel"):
            raise HTTPException(400, "fuel_type must be 'Petrol' or 'Diesel'")
        qty = body.get("quantity_litres")
        rate = body.get("rate_per_litre")
        try:
            qty = float(qty) if qty not in (None, "") else None
            rate = float(rate) if rate not in (None, "") else None
        except (TypeError, ValueError):
            raise HTTPException(400, "Quantity and Rate per Litre must be numbers")
        doc.update({
            "bus_route_id": bus_route_id, "session": session, "fuel_type": fuel_type,
            "quantity_litres": qty, "rate_per_litre": rate,
        })
        # Quantity x Rate is offered as a convenience cross-check, never a silent
        # override of the amount actually entered/approved for the expense.
        if qty is not None and rate is not None:
            computed = round(qty * rate, 2)
            if abs(computed - amount) > 1.0:
                doc["quantity_rate_mismatch_note"] = (
                    f"Quantity x Rate = {computed}, differs from entered Amount {amount} — kept as entered."
                )
    return doc


async def _resolve_bus_no(doc: Dict[str, Any]) -> Optional[str]:
    if not doc.get("bus_route_id"):
        return None
    route = await db.bus_routes.find_one({"id": doc["bus_route_id"]}, {"_id": 0})
    if not route:
        raise HTTPException(400, "Selected bus not found in Bus Master")
    return route.get("vehicle_no") or route.get("code")


@router.post("/expenses")
async def create_expense(body: Dict[str, Any], user=Depends(require_roles(*FINANCE_ROLES))):
    doc = _validate_expense_body(body)
    doc["bus_no"] = await _resolve_bus_no(doc)

    ay = _current_academic_year()
    expense_no = await next_expense_number(ay)
    eid = gen_id()
    doc.update({
        "id": eid, "expense_no": expense_no, "academic_year": ay, "status": "issued",
        "created_at": now_iso(), "created_by": user["name"], "created_by_id": user["id"],
        "void_reason": None, "voided_at": None, "voided_by": None,
    })
    await db.expenses.insert_one(doc)
    await audit(user, "create", "expense", eid, {"expense_no": expense_no, "category": doc["category"], "amount": doc["amount"]})
    return {k: v for k, v in doc.items() if k != "_id"}


# Fields an Alter may change. Deliberately excludes id/expense_no/academic_year/
# status/void*/created_*/audit metadata - alter re-validates and updates content,
# it never touches numbering, history, or void state (use /void for that).
_EXPENSE_ALTER_FIELDS = {
    "date", "category", "custom_expense_name", "description", "to_whom", "who_brought_bill",
    "amount", "payment_mode", "cheque_no", "remarks",
    "bus_route_id", "session", "fuel_type", "quantity_litres", "rate_per_litre",
}


@router.patch("/expenses/{eid}")
async def alter_expense(eid: str, body: Dict[str, Any], user=Depends(require_roles(*FINANCE_ROLES))):
    """Alter an existing expense's content. Re-runs the exact same validation as
    creation (Bank/Cheque cheque_no requirement, Other custom-name requirement,
    Petrol/Diesel fields) against the MERGED (existing + incoming) record, so a
    partial edit can never leave the stored record in an inconsistent state."""
    existing = await db.expenses.find_one({"id": eid})
    if not existing:
        raise HTTPException(404, "Not found")
    if existing.get("status") == "void":
        raise HTTPException(409, "This expense is void and cannot be altered — void/cancel is permanent, per accounting policy")

    incoming = {k: v for k, v in body.items() if k in _EXPENSE_ALTER_FIELDS}
    if not incoming:
        raise HTTPException(400, "Nothing to update")
    merged = {**existing, **incoming}
    doc = _validate_expense_body(merged)
    doc["bus_no"] = await _resolve_bus_no(doc)

    before_snapshot = {k: existing.get(k) for k in doc.keys()}
    doc["updated_at"] = now_iso()
    doc["updated_by"] = user["name"]
    await db.expenses.update_one({"id": eid}, {"$set": doc})

    await audit(user, "alter", "expense", eid, {
        "expense_no": existing.get("expense_no"),
        "before": before_snapshot, "after": {k: doc.get(k) for k in doc.keys()},
    })
    return await db.expenses.find_one({"id": eid}, {"_id": 0})


@router.get("/expenses")
async def list_expenses(
    q: Optional[str] = None, category: Optional[str] = None, payment_mode: Optional[str] = None,
    status: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    bus_route_id: Optional[str] = None, who_brought_bill: Optional[str] = None, to_whom: Optional[str] = None,
    limit: int = 500, user=Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if category: query["category"] = category
    if payment_mode: query["payment_mode"] = payment_mode
    if status: query["status"] = status
    if bus_route_id: query["bus_route_id"] = bus_route_id
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to
        query["date"] = rng
    if who_brought_bill:
        query["who_brought_bill"] = {"$regex": re.escape(who_brought_bill), "$options": "i"}
    if to_whom:
        query["to_whom"] = {"$regex": re.escape(to_whom), "$options": "i"}
    if q:
        safe_q = re.escape(q)
        query["$or"] = [
            {"expense_no": {"$regex": safe_q, "$options": "i"}},
            {"description": {"$regex": safe_q, "$options": "i"}},
            {"to_whom": {"$regex": safe_q, "$options": "i"}},
            {"who_brought_bill": {"$regex": safe_q, "$options": "i"}},
            {"bus_no": {"$regex": safe_q, "$options": "i"}},
            {"custom_expense_name": {"$regex": safe_q, "$options": "i"}},
        ]
    return await db.expenses.find(query, {"_id": 0}).sort("date", -1).limit(limit).to_list(limit)


@router.get("/expenses/{eid}")
async def get_expense(eid: str, user=Depends(get_current_user)):
    doc = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


@router.post("/expenses/{eid}/void")
async def void_expense(eid: str, body: Dict[str, Any], user=Depends(require_roles(*VOID_ROLES))):
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to void an expense")
    doc = await db.expenses.find_one({"id": eid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("status") == "void":
        raise HTTPException(409, "This expense is already void")
    await db.expenses.update_one({"id": eid}, {"$set": {
        "status": "void", "void_reason": reason, "voided_at": now_iso(), "voided_by": user["name"],
    }})
    await audit(user, "void", "expense", eid, {"expense_no": doc.get("expense_no"), "reason": reason, "amount": doc.get("amount")})
    return {"ok": True}


# ============================================================================
# Expense reports / summaries
# ============================================================================
async def _active_expenses(date_from=None, date_to=None, extra: Optional[Dict[str, Any]] = None):
    query: Dict[str, Any] = {"status": {"$ne": "void"}}
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to
        query["date"] = rng
    if extra:
        query.update(extra)
    return await db.expenses.find(query, {"_id": 0}).to_list(20000)


@router.get("/reports/expenses/category-wise")
async def expense_report_category_wise(date_from: Optional[str] = None, date_to: Optional[str] = None, user=Depends(get_current_user)):
    rows = await _active_expenses(date_from, date_to)
    by_cat: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        c = by_cat.setdefault(r["category"], {"category": r["category"], "count": 0, "amount": 0.0})
        c["count"] += 1
        c["amount"] += float(r.get("amount", 0))
    return sorted(by_cat.values(), key=lambda x: -x["amount"])


@router.get("/reports/expenses/payment-mode-wise")
async def expense_report_payment_mode_wise(date_from: Optional[str] = None, date_to: Optional[str] = None, user=Depends(get_current_user)):
    rows = await _active_expenses(date_from, date_to)
    by_mode: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        m = by_mode.setdefault(r["payment_mode"], {"payment_mode": r["payment_mode"], "count": 0, "amount": 0.0})
        m["count"] += 1
        m["amount"] += float(r.get("amount", 0))
    return sorted(by_mode.values(), key=lambda x: -x["amount"])


@router.get("/reports/expenses/person-wise")
async def expense_report_person_wise(date_from: Optional[str] = None, date_to: Optional[str] = None, user=Depends(get_current_user)):
    """'Who Brought Bill' breakdown."""
    rows = await _active_expenses(date_from, date_to)
    by_person: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        p = by_person.setdefault(r["who_brought_bill"], {"who_brought_bill": r["who_brought_bill"], "count": 0, "amount": 0.0})
        p["count"] += 1
        p["amount"] += float(r.get("amount", 0))
    return sorted(by_person.values(), key=lambda x: -x["amount"])


@router.get("/reports/expenses/payee-wise")
async def expense_report_payee_wise(date_from: Optional[str] = None, date_to: Optional[str] = None, user=Depends(get_current_user)):
    """'To Whom' (payee/vendor) breakdown."""
    rows = await _active_expenses(date_from, date_to)
    by_payee: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        p = by_payee.setdefault(r["to_whom"], {"to_whom": r["to_whom"], "count": 0, "amount": 0.0})
        p["count"] += 1
        p["amount"] += float(r.get("amount", 0))
    return sorted(by_payee.values(), key=lambda x: -x["amount"])


@router.get("/reports/expenses/monthly")
async def expense_report_monthly(year: Optional[str] = None, user=Depends(get_current_user)):
    rows = await _active_expenses()
    by_month: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        d = r.get("date") or ""
        month_key = d[:7]  # "YYYY-MM"
        if year and not month_key.startswith(year):
            continue
        m = by_month.setdefault(month_key, {"month": month_key, "count": 0, "amount": 0.0})
        m["count"] += 1
        m["amount"] += float(r.get("amount", 0))
    return sorted(by_month.values(), key=lambda x: x["month"])


@router.get("/reports/expenses/bus-fuel")
async def expense_report_bus_fuel(
    bus_route_id: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Bus-wise / date-wise / monthly fuel expense — accounting-only, never touches
    Bus Assignment/Bus Fee. Groups strictly by bus, with litres/amount/avg rate."""
    extra = {"category": FUEL_CATEGORY}
    if bus_route_id: extra["bus_route_id"] = bus_route_id
    rows = await _active_expenses(date_from, date_to, extra)
    by_bus: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        key = r.get("bus_route_id") or "unassigned"
        b = by_bus.setdefault(key, {
            "bus_route_id": r.get("bus_route_id"), "bus_no": r.get("bus_no"),
            "total_litres": 0.0, "total_amount": 0.0, "entries": 0,
        })
        b["total_litres"] += float(r.get("quantity_litres") or 0)
        b["total_amount"] += float(r.get("amount") or 0)
        b["entries"] += 1
    out = list(by_bus.values())
    for b in out:
        b["average_rate_per_litre"] = round(b["total_amount"] / b["total_litres"], 2) if b["total_litres"] else None
        b["total_litres"] = round(b["total_litres"], 2)
        b["total_amount"] = round(b["total_amount"], 2)
    return {
        "by_bus": sorted(out, key=lambda x: -x["total_amount"]),
        "entries": sorted(rows, key=lambda r: r.get("date",""), reverse=True),
        "grand_total_litres": round(sum(b["total_litres"] for b in out), 2),
        "grand_total_amount": round(sum(b["total_amount"] for b in out), 2),
    }


# ============================================================================
# Daily Fee & Expense Report
# ============================================================================
@router.get("/reports/daily-fee-expense")
async def daily_fee_expense_report(date: Optional[str] = None, user=Depends(get_current_user)):
    day = date or _date.today().isoformat()

    receipts = await db.receipts.find(
        {"created_at": {"$gte": day + "T00:00:00", "$lte": day + "T23:59:59.999999"}, "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(5000)
    by_mode: Dict[str, float] = {}
    for r in receipts:
        if r.get("receipt_type") in ("refund", "debit_voucher"):
            continue  # not a fee collection
        mode = (r.get("payment_mode") or "other").lower()
        norm = "cash" if mode == "cash" else ("upi" if mode == "upi" else "other")
        by_mode[norm] = by_mode.get(norm, 0) + float(r.get("total", 0) or 0)
    cash_collection = round(by_mode.get("cash", 0), 2)
    upi_collection = round(by_mode.get("upi", 0), 2)
    other_collection = round(by_mode.get("other", 0), 2)
    total_fee_collection = round(cash_collection + upi_collection + other_collection, 2)

    expenses = await db.expenses.find({"date": day, "status": {"$ne": "void"}}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    expense_rows = [{
        "expense_no": e["expense_no"], "category": e.get("category_display") or e["category"], "description": e["description"],
        "who_brought_bill": e["who_brought_bill"], "payment_mode": e["payment_mode"], "amount": e["amount"],
    } for e in expenses]
    total_expenses = round(sum(e["amount"] for e in expense_rows), 2)

    # Debit Vouchers (money OUT, never a fee collection) - same receipts already
    # excluded from fee_collection_summary above, surfaced here as their own
    # outgoing total so the report's Net figure actually accounts for them
    # instead of silently ignoring them (previously this report had no voucher
    # line at all - see Voucher Report for the full itemised register).
    voucher_rows = [{
        "voucher_no": r["number"], "date": r["created_at"][:10], "description": r.get("remarks") or r.get("payer_name") or "",
        "created_by": r.get("cashier_name"), "amount": r.get("total", 0),
    } for r in receipts if r.get("receipt_type") == "debit_voucher"]
    total_debit_vouchers = round(sum(v["amount"] for v in voucher_rows), 2)

    net_collection_after_expenses = round(total_fee_collection - total_expenses, 2)
    net_collection_after_outgoings = round(total_fee_collection - total_expenses - total_debit_vouchers, 2)

    settings = await db.settings.find_one({"id": "school_settings"}, {"_id": 0}) or {}

    return {
        "date": day,
        "academic_year": _current_academic_year(),
        "generated_at": now_iso(),
        "generated_by": user["name"],
        "school": {
            "name": settings.get("school_name"), "address": settings.get("school_address"),
            "phone": settings.get("school_phone"), "email": settings.get("school_email"),
        },
        "fee_collection_summary": {
            "cash_collection": cash_collection, "upi_collection": upi_collection,
            "other_collection": other_collection, "total_fee_collection": total_fee_collection,
        },
        "expenses": expense_rows,
        "total_expenses": total_expenses,
        "debit_vouchers": voucher_rows,
        "total_debit_vouchers": total_debit_vouchers,
        "total_summary": {
            "total_fee_collection": total_fee_collection, "total_expenses": total_expenses,
            "total_debit_vouchers": total_debit_vouchers,
            "net_collection_after_expenses": net_collection_after_expenses,
            "net_collection_after_outgoings": net_collection_after_outgoings,
        },
    }


@router.get("/reports/daily-fee-expense/pdf")
async def daily_fee_expense_report_pdf(date: Optional[str] = None, user=Depends(get_current_user)):
    from fastapi.responses import Response
    import io, html as _html
    from xhtml2pdf import pisa

    data = await daily_fee_expense_report(date=date, user=user)
    fcs = data["fee_collection_summary"]
    ts = data["total_summary"]
    school = data["school"]

    def row(label, amount, bold=False):
        cls = ' class="b"' if bold else ""
        return f"<tr><td{cls}>{_html.escape(label)}</td><td{cls} class='r'>{_inr(amount)}</td></tr>"

    exp_rows = "".join(
        f"<tr><td>{i+1}</td><td>{_html.escape(e['expense_no'])}</td><td>{_html.escape(e['category'])}</td>"
        f"<td>{_html.escape(e['description'])}</td><td>{_html.escape(e['who_brought_bill'])}</td>"
        f"<td>{_html.escape(e['payment_mode'].replace('_',' ').upper())}</td><td class='r'>{_inr(e['amount'])}</td></tr>"
        for i, e in enumerate(data["expenses"])
    ) or "<tr><td colspan='7' style='text-align:center;color:#888;'>No expenses recorded for this date.</td></tr>"

    contact_line = " | ".join(x for x in [
        f"Mob: {school['phone']}" if school.get("phone") else None,
        f"Email: {school['email']}" if school.get("email") else None,
    ] if x)

    html_str = f"""<html><head><style>
      /* Approved final design: vertical receipt-size page — the SAME physical
         paper as the existing 210x142.8mm fee receipt, just used portrait
         (142.8mm wide x 210mm tall) instead of landscape. This report is a
         separate document; the actual fee receipt's own paper size/layout/
         printer config is completely untouched. */
      @page {{ size: 142.8mm 210mm; margin: 5mm 4mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 7.2px; }}
      .hd {{ text-align:center; border-bottom: 1.5px solid #222; padding-bottom: 5px; margin-bottom: 6px; }}
      .hd h1 {{ font-size: 12px; margin: 0 0 2px; letter-spacing: 0.4px; }}
      .hd .sub {{ font-size: 6.6px; color:#333; margin: 1px 0; }}
      .title {{ text-align:center; font-size: 9px; font-weight: bold; letter-spacing: 0.6px; margin: 6px 0 6px; text-transform: uppercase; }}
      .meta {{ font-size: 6.6px; color:#222; margin-bottom: 8px; border: 1px solid #ccc; padding: 3px 5px; }}
      .meta div {{ padding: 0.5px 0; }}
      .meta b {{ display:inline-block; width: 32mm; }}
      .section {{ font-weight: bold; font-size: 7.4px; text-transform: uppercase; background:#eef1f5; border: 1px solid #999; padding: 2px 4px; margin: 7px 0 3px; }}
      table.acc {{ width:100%; border-collapse: collapse; margin-bottom: 3px; }}
      table.acc th {{ background:#f0f0f0; border: 1px solid #999; padding: 2px 2px; text-align:left; font-size: 6.2px; }}
      table.acc td {{ border: 1px solid #ccc; padding: 2px 2px; font-size: 6.4px; word-break: break-word; }}
      table.acc td.r, table.acc th.r {{ text-align:right; font-family: monospace; }}
      table.acc tr.total td {{ font-weight: bold; border-top: 1.5px solid #333; background:#f7f7f7; }}
      table.plain {{ width:100%; border-collapse: collapse; }}
      table.plain td {{ padding: 2px 5px; border: 1px solid #ccc; font-size: 7px; }}
      table.plain td.r {{ text-align:right; font-family: monospace; }}
      td.b {{ font-weight: bold; }}
      .sig {{ margin-top: 22mm; width:100%; }}
      .sig td {{ width:50%; text-align:center; border-top: 1px solid #333; padding-top: 3px; font-weight: bold; font-size: 6.8px; }}
      .ftr {{ margin-top: 8px; text-align:center; font-size: 5.6px; color:#777; }}
      col.c-sno {{ width: 5%; }} col.c-exp {{ width: 14%; }} col.c-cat {{ width: 15%; }}
      col.c-desc {{ width: 24%; }} col.c-who {{ width: 17%; }} col.c-mode {{ width: 11%; }} col.c-amt {{ width: 14%; }}
    </style></head><body>
      <div class="hd">
        <h1>{_html.escape((school.get('name') or 'BALAJI CONVENT').upper())}</h1>
        <div class="sub">{_html.escape(school.get('address') or '')}</div>
        <div class="sub">{_html.escape(contact_line)}</div>
      </div>
      <div class="title">Daily Fee &amp; Expense Report</div>
      <div class="meta">
        <div><b>Date:</b> {data['date']}</div>
        <div><b>Academic Year:</b> {data['academic_year']}</div>
        <div><b>Generated On:</b> {data['generated_at'][:16].replace('T',' ')}</div>
        <div><b>User:</b> {_html.escape(data['generated_by'])}</div>
        <div><b>Page:</b> 1</div>
      </div>

      <div class="section">A. Fee Collection Summary</div>
      <table class="plain">
        {row('Cash Collection', fcs['cash_collection'])}
        {row('UPI Collection', fcs['upi_collection'])}
        {(row('Other Collection', fcs['other_collection']) if fcs['other_collection'] else '')}
        {row('TOTAL FEE COLLECTION', fcs['total_fee_collection'], bold=True)}
      </table>

      <div class="section">B. Expenses (Today)</div>
      <table class="acc">
        <colgroup><col class="c-sno"/><col class="c-exp"/><col class="c-cat"/><col class="c-desc"/><col class="c-who"/><col class="c-mode"/><col class="c-amt"/></colgroup>
        <thead><tr><th>S.No</th><th>Exp. No.</th><th>Category</th><th>Description</th><th>Who Brought Bill</th><th>Mode</th><th class="r">Amount</th></tr></thead>
        <tbody>{exp_rows}</tbody>
        <tr class="total"><td colspan="6" class="r">TOTAL EXPENSES</td><td class="r">{_inr(data['total_expenses'])}</td></tr>
      </table>

      <div class="section">C. Total Summary</div>
      <table class="plain">
        {row('Total Fee Collection (A)', ts['total_fee_collection'])}
        {row('Total Expenses (B)', ts['total_expenses'])}
        {(row('Debit Vouchers / Money Out', ts['total_debit_vouchers']) if ts['total_debit_vouchers'] else '')}
        {row('NET COLLECTION', ts['net_collection_after_outgoings'], bold=True)}
      </table>

      <table class="sig">
        <tr><td>Cashier</td><td>Authorised Signatory</td></tr>
      </table>
      <div class="ftr">Balaji Convent - School Management System<br/>This is a computer generated report.</div>
    </body></html>"""

    buf = io.BytesIO()
    pisa.CreatePDF(html_str, dest=buf)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="Daily-Fee-Expense-{data["date"]}.pdf"'})


def _inr(n) -> str:
    try:
        n = float(n or 0)
    except (TypeError, ValueError):
        n = 0
    return f"{n:,.2f}"


@router.get("/reports/daily-fee-expense/export")
async def daily_fee_expense_report_export(date: Optional[str] = None, format: str = "xlsx", user=Depends(get_current_user)):
    """Excel/CSV export of the SAME Daily Fee & Expense Report data as the approved
    PDF/print design above - same three sections (A/B/C), same figures, just tabular.
    Does not change the approved print/PDF layout in any way."""
    from fastapi.responses import Response

    data = await daily_fee_expense_report(date=date, user=user)
    fcs = data["fee_collection_summary"]
    ts = data["total_summary"]

    def section_a():
        rows = [
            ["Cash Collection", fcs["cash_collection"]],
            ["UPI Collection", fcs["upi_collection"]],
        ]
        if fcs["other_collection"]:
            rows.append(["Other Collection", fcs["other_collection"]])
        rows.append(["Total Fee Collection", fcs["total_fee_collection"]])
        return rows

    def section_c():
        rows = [
            ["Total Fee Collection (A)", ts["total_fee_collection"]],
            ["Total Expenses (B)", ts["total_expenses"]],
        ]
        if ts["total_debit_vouchers"]:
            rows.append(["Debit Vouchers / Money Out", ts["total_debit_vouchers"]])
        rows.append(["Net Collection", ts["net_collection_after_outgoings"]])
        return rows

    if format == "csv":
        import io, csv as _csv
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["Daily Fee & Expense Report", data["date"]])
        w.writerow(["Academic Year", data["academic_year"]])
        w.writerow([])
        w.writerow(["A. Fee Collection Summary"])
        for r in section_a(): w.writerow(r)
        w.writerow([])
        w.writerow(["B. Expenses (Today)"])
        w.writerow(["S.No", "Expense No.", "Category", "Description", "Who Brought Bill", "Mode", "Amount"])
        for i, e in enumerate(data["expenses"], 1):
            w.writerow([i, e["expense_no"], e["category"], e["description"], e["who_brought_bill"], e["payment_mode"].replace("_", " ").upper(), e["amount"]])
        w.writerow(["", "", "", "", "", "Total Expenses", data["total_expenses"]])
        w.writerow([])
        w.writerow(["C. Total Summary"])
        for r in section_c(): w.writerow(r)
        return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                         headers={"Content-Disposition": f'attachment; filename="Daily_Fee_Expense_{data["date"]}.csv"'})

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Daily Fee & Expense"
        bold = Font(bold=True)
        section_fill = PatternFill("solid", fgColor="EEF1F5")

        ws.append(["Daily Fee & Expense Report", data["date"]])
        ws["A1"].font = Font(bold=True, size=13)
        ws.append(["Academic Year", data["academic_year"]])
        ws.append([])

        ws.append(["A. Fee Collection Summary"])
        ws[f"A{ws.max_row}"].font = bold; ws[f"A{ws.max_row}"].fill = section_fill
        for label, amt in section_a():
            ws.append([label, amt])
            if label.startswith("Total"):
                ws[f"A{ws.max_row}"].font = bold; ws[f"B{ws.max_row}"].font = bold
        ws.append([])

        ws.append(["B. Expenses (Today)"])
        ws[f"A{ws.max_row}"].font = bold; ws[f"A{ws.max_row}"].fill = section_fill
        header_row = ["S.No", "Expense No.", "Category", "Description", "Who Brought Bill", "Mode", "Amount"]
        ws.append(header_row)
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for i, e in enumerate(data["expenses"], 1):
            ws.append([i, e["expense_no"], e["category"], e["description"], e["who_brought_bill"], e["payment_mode"].replace("_", " ").upper(), e["amount"]])
        ws.append(["", "", "", "", "", "Total Expenses", data["total_expenses"]])
        ws[f"F{ws.max_row}"].font = bold; ws[f"G{ws.max_row}"].font = bold
        ws.append([])

        ws.append(["C. Total Summary"])
        ws[f"A{ws.max_row}"].font = bold; ws[f"A{ws.max_row}"].fill = section_fill
        for label, amt in section_c():
            ws.append([label, amt])
            if label.startswith("Net"):
                ws[f"A{ws.max_row}"].font = bold; ws[f"B{ws.max_row}"].font = bold

        for idx, w in enumerate([26, 14, 16, 30, 18, 12, 14], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": f'attachment; filename="Daily_Fee_Expense_{data["date"]}.xlsx"'})

    raise HTTPException(400, f"Unknown format '{format}' - use csv or xlsx")


# ============================================================================
# Bill Entry — School Master
# ============================================================================
@router.get("/bill-schools")
async def list_bill_schools(include_inactive: bool = False, user=Depends(get_current_user)):
    q: Dict[str, Any] = {} if include_inactive else {"active": {"$ne": False}}
    return await db.bill_schools.find(q, {"_id": 0}).sort("name", 1).to_list(200)


@router.post("/bill-schools")
async def create_bill_school(body: Dict[str, Any], user=Depends(require_roles("administrator"))):
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "School Name is required")
    sid = gen_id()
    doc = {
        "id": sid, "name": name, "code": (str(body.get("code")).strip().upper() or None) if body.get("code") else None,
        "address": body.get("address") or None, "contact": body.get("contact") or None,
        "active": True, "created_at": now_iso(),
    }
    await db.bill_schools.insert_one(doc)
    await audit(user, "create", "bill_school", sid, {"name": name})
    return {k: v for k, v in doc.items() if k != "_id"}


@router.patch("/bill-schools/{sid}")
async def update_bill_school(sid: str, body: Dict[str, Any], user=Depends(require_roles("administrator"))):
    existing = await db.bill_schools.find_one({"id": sid})
    if not existing:
        raise HTTPException(404, "Not found")
    allowed = {"name", "code", "address", "contact", "active"}
    upd = {k: v for k, v in body.items() if k in allowed}
    if not upd:
        raise HTTPException(400, "Nothing to update")
    await db.bill_schools.update_one({"id": sid}, {"$set": upd})
    await audit(user, "update", "bill_school", sid, {"before": {k: existing.get(k) for k in upd}, "after": upd})
    return await db.bill_schools.find_one({"id": sid}, {"_id": 0})


# ---------------- Bill Categories (separate master from Expense Categories) ----------------
DEFAULT_BILL_CATEGORIES = ["Stationery", "Printing", "Computer / IT", "Furniture", "Books", "Uniform", "Other"]


async def _seed_bill_categories_if_empty():
    if await db.bill_categories.count_documents({}) > 0:
        return
    now = now_iso()
    for i, name in enumerate(DEFAULT_BILL_CATEGORIES):
        await db.bill_categories.insert_one({"id": gen_id(), "name": name, "display_order": i * 10, "active": True, "created_at": now})


@router.get("/bill-categories")
async def list_bill_categories(include_inactive: bool = False, user=Depends(get_current_user)):
    await _seed_bill_categories_if_empty()
    q: Dict[str, Any] = {} if include_inactive else {"active": {"$ne": False}}
    return await db.bill_categories.find(q, {"_id": 0}).sort("display_order", 1).to_list(200)


@router.post("/bill-categories")
async def create_bill_category(body: Dict[str, Any], user=Depends(require_roles("administrator"))):
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Category name is required")
    if await db.bill_categories.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise HTTPException(400, f"Category '{name}' already exists")
    cid = gen_id()
    n = await db.bill_categories.count_documents({})
    doc = {"id": cid, "name": name, "display_order": (n + 1) * 10, "active": True, "created_at": now_iso()}
    await db.bill_categories.insert_one(doc)
    await audit(user, "create", "bill_category", cid, {"name": name})
    return {k: v for k, v in doc.items() if k != "_id"}


# ============================================================================
# Bills
# ============================================================================
BILL_STATUSES = ("pending", "paid", "partially_paid")


@router.post("/bills")
async def create_bill(body: Dict[str, Any], user=Depends(require_roles(*FINANCE_ROLES))):
    school_id = body.get("school_id")
    invoice_no = str(body.get("invoice_no") or "").strip()
    bill_date = str(body.get("bill_date") or "").strip() or _date.today().isoformat()
    supplier_name = str(body.get("supplier_name") or "").strip()
    category = str(body.get("category") or "").strip()
    description = str(body.get("description") or "").strip()
    who_brought_bill = str(body.get("who_brought_bill") or "").strip()

    if not school_id:
        raise HTTPException(400, "School is required")
    school = await db.bill_schools.find_one({"id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(400, "Selected school not found in Bill Entry School Master")
    if not supplier_name:
        raise HTTPException(400, "Supplier/Vendor Name is required")
    if not category:
        raise HTTPException(400, "Bill Category is required")
    if not description:
        raise HTTPException(400, "Description is required")
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Amount must be a number")
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    gst = body.get("gst")
    try:
        gst = float(gst) if gst not in (None, "") else 0.0
    except (TypeError, ValueError):
        raise HTTPException(400, "GST must be a number")
    total_bill_amount = round(amount + gst, 2)

    status = str(body.get("status") or "pending").strip().lower()
    if status not in BILL_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(BILL_STATUSES)}")

    ay = _current_academic_year()
    bill_no = await next_bill_number(ay)
    bid = gen_id()
    doc = {
        "id": bid, "bill_no": bill_no, "school_id": school_id, "school_name": school["name"],
        "invoice_no": invoice_no or None, "bill_date": bill_date, "supplier_name": supplier_name,
        "category": category, "description": description, "amount": amount, "gst": gst,
        "total_bill_amount": total_bill_amount, "due_date": body.get("due_date") or None,
        "status": status, "who_brought_bill": who_brought_bill or None, "remarks": body.get("remarks") or None,
        "academic_year": ay, "voided": False, "void_reason": None, "voided_at": None, "voided_by": None,
        "created_at": now_iso(), "created_by": user["name"], "created_by_id": user["id"],
        "updated_at": now_iso(), "updated_by": user["name"],
    }
    await db.bills.insert_one(doc)
    await audit(user, "create", "bill", bid, {"bill_no": bill_no, "supplier_name": supplier_name, "total_bill_amount": total_bill_amount})
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/bills")
async def list_bills(
    q: Optional[str] = None, school_id: Optional[str] = None, category: Optional[str] = None,
    supplier_name: Optional[str] = None, status: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    include_void: bool = False, limit: int = 500, user=Depends(get_current_user),
):
    query: Dict[str, Any] = {} if include_void else {"voided": {"$ne": True}}
    if school_id: query["school_id"] = school_id
    if category: query["category"] = category
    if status: query["status"] = status
    if supplier_name: query["supplier_name"] = {"$regex": re.escape(supplier_name), "$options": "i"}
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to
        query["bill_date"] = rng
    if q:
        safe_q = re.escape(q)
        query["$or"] = [
            {"bill_no": {"$regex": safe_q, "$options": "i"}},
            {"invoice_no": {"$regex": safe_q, "$options": "i"}},
            {"supplier_name": {"$regex": safe_q, "$options": "i"}},
            {"description": {"$regex": safe_q, "$options": "i"}},
            {"school_name": {"$regex": safe_q, "$options": "i"}},
        ]
    return await db.bills.find(query, {"_id": 0}).sort("bill_date", -1).limit(limit).to_list(limit)


@router.get("/bills/{bid}")
async def get_bill(bid: str, user=Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


@router.patch("/bills/{bid}")
async def alter_bill(bid: str, body: Dict[str, Any], user=Depends(require_roles(*FINANCE_ROLES))):
    existing = await db.bills.find_one({"id": bid})
    if not existing:
        raise HTTPException(404, "Not found")
    if existing.get("voided"):
        raise HTTPException(409, "This bill is void and cannot be altered")
    allowed = {"invoice_no", "bill_date", "supplier_name", "category", "description",
               "amount", "gst", "due_date", "status", "who_brought_bill", "remarks"}
    upd = {k: v for k, v in body.items() if k in allowed}
    if "status" in upd and upd["status"] not in BILL_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(BILL_STATUSES)}")
    if not upd:
        raise HTTPException(400, "Nothing to update")
    amount = float(upd.get("amount", existing["amount"]))
    gst = float(upd.get("gst", existing.get("gst", 0)))
    upd["total_bill_amount"] = round(amount + gst, 2)
    upd["updated_at"] = now_iso()
    upd["updated_by"] = user["name"]
    await db.bills.update_one({"id": bid}, {"$set": upd})
    await audit(user, "alter", "bill", bid, {"bill_no": existing.get("bill_no"),
                "before": {k: existing.get(k) for k in upd if k in existing}, "after": upd})
    return await db.bills.find_one({"id": bid}, {"_id": 0})


@router.post("/bills/{bid}/void")
async def void_bill(bid: str, body: Dict[str, Any], user=Depends(require_roles(*VOID_ROLES))):
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to void/cancel a bill")
    doc = await db.bills.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("voided"):
        raise HTTPException(409, "This bill is already void")
    await db.bills.update_one({"id": bid}, {"$set": {
        "voided": True, "void_reason": reason, "voided_at": now_iso(), "voided_by": user["name"],
    }})
    await audit(user, "void", "bill", bid, {"bill_no": doc.get("bill_no"), "reason": reason})
    return {"ok": True}


# ============================================================================
# Bill reports / summaries
# ============================================================================
@router.get("/reports/bills/register")
async def bill_register(
    school_id: Optional[str] = None, category: Optional[str] = None, supplier_name: Optional[str] = None,
    status: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Primary Bill Register with grand totals — independent of Fee Collection / Expense totals."""
    bills = await list_bills(q=None, school_id=school_id, category=category, supplier_name=supplier_name,
                              status=status, date_from=date_from, date_to=date_to, limit=5000, user=user)
    return {
        "bills": bills,
        "total_bills": len(bills),
        "total_amount": round(sum(b["amount"] for b in bills), 2),
        "total_gst": round(sum(b.get("gst", 0) for b in bills), 2),
        "total_bill_value": round(sum(b["total_bill_amount"] for b in bills), 2),
    }


def _group_totals(bills: List[dict], key: str) -> List[dict]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for b in bills:
        k = b.get(key) or "—"
        g = by_key.setdefault(k, {key: k, "count": 0, "amount": 0.0, "total_bill_amount": 0.0})
        g["count"] += 1
        g["amount"] += float(b.get("amount", 0))
        g["total_bill_amount"] += float(b.get("total_bill_amount", 0))
    return sorted(by_key.values(), key=lambda x: -x["total_bill_amount"])


@router.get("/reports/bills/summary")
async def bill_summary(date_from: Optional[str] = None, date_to: Optional[str] = None, user=Depends(get_current_user)):
    bills = await list_bills(q=None, school_id=None, category=None, supplier_name=None, status=None,
                              date_from=date_from, date_to=date_to, limit=5000, user=user)
    return {
        "by_school": _group_totals(bills, "school_name"),
        "by_category": _group_totals(bills, "category"),
        "by_supplier": _group_totals(bills, "supplier_name"),
        "by_status": _group_totals(bills, "status"),
    }


# ============================================================================
# Debit Voucher Report — a Debit Voucher is stored as an ordinary receipt with
# receipt_type == "debit_voucher" (see core.py ReceiptIn / receipts.py), never
# a separate collection. This report just gives that slice of receipts its
# own dedicated, filterable register + PDF/Excel, matching the Bill Register's
# pattern above. It reads receipts only - never writes, never touches fee
# collection/expense totals itself.
# ============================================================================
async def _voucher_rows(date_from: Optional[str], date_to: Optional[str],
                         voucher_no: Optional[str], created_by: Optional[str]) -> List[dict]:
    q: Dict[str, Any] = {"receipt_type": "debit_voucher", "status": {"$ne": "cancelled"}}
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from: rng["$gte"] = date_from + "T00:00:00"
        if date_to: rng["$lte"] = date_to + "T23:59:59.999999"
        q["created_at"] = rng
    if voucher_no:
        q["number"] = {"$regex": re.escape(voucher_no), "$options": "i"}
    if created_by:
        q["cashier_name"] = {"$regex": re.escape(created_by), "$options": "i"}
    receipts = await db.receipts.find(q, {"_id": 0}).sort("created_at", 1).to_list(5000)
    return [{
        "id": r["id"], "voucher_no": r["number"], "date": r["created_at"][:10],
        "description": r.get("remarks") or r.get("payer_name") or "",
        "created_by": r.get("cashier_name"), "amount": round(float(r.get("total", 0) or 0), 2),
    } for r in receipts]


@router.get("/reports/vouchers")
async def voucher_register(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    voucher_no: Optional[str] = None, created_by: Optional[str] = None,
    user=Depends(get_current_user),
):
    rows = await _voucher_rows(date_from, date_to, voucher_no, created_by)
    return {
        "rows": rows, "count": len(rows),
        "total_amount": round(sum(v["amount"] for v in rows), 2),
        "date_from": date_from, "date_to": date_to,
    }


@router.get("/reports/vouchers/pdf")
async def voucher_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    voucher_no: Optional[str] = None, created_by: Optional[str] = None,
    user=Depends(get_current_user),
):
    from fastapi.responses import Response
    import io, html as _html
    from xhtml2pdf import pisa

    rows = await _voucher_rows(date_from, date_to, voucher_no, created_by)
    total = round(sum(v["amount"] for v in rows), 2)
    settings = await db.settings.find_one({"id": "school_settings"}, {"_id": 0}) or {}
    contact_line = " | ".join(x for x in [
        f"Mob: {settings['school_phone']}" if settings.get("school_phone") else None,
        f"Email: {settings['school_email']}" if settings.get("school_email") else None,
    ] if x)
    period = f"{date_from or '—'} to {date_to or '—'}"

    body_rows = "".join(
        f"<tr><td>{i+1}</td><td>{_html.escape(v['voucher_no'])}</td><td>{_html.escape(v['date'])}</td>"
        f"<td>{_html.escape(v['description'] or '')}</td><td>{_html.escape(v['created_by'] or '')}</td>"
        f"<td class='r'>{_inr(v['amount'])}</td></tr>"
        for i, v in enumerate(rows)
    ) or "<tr><td colspan='6' style='text-align:center;color:#888;'>No debit vouchers for this filter.</td></tr>"

    html_str = f"""<html><head><style>
      @page {{ size: A4 portrait; margin: 14mm 12mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 10px; }}
      .hd {{ text-align:center; border-bottom: 1.5px solid #222; padding-bottom: 8px; margin-bottom: 10px; }}
      .hd h1 {{ font-size: 16px; margin: 0 0 3px; letter-spacing: 0.4px; }}
      .hd .sub {{ font-size: 9px; color:#333; margin: 1px 0; }}
      .title {{ text-align:center; font-size: 13px; font-weight: bold; letter-spacing: 0.8px; margin: 8px 0 4px; text-transform: uppercase; }}
      .meta {{ text-align:center; font-size: 9px; color:#444; margin-bottom: 12px; }}
      table.v {{ width:100%; border-collapse: collapse; }}
      table.v th {{ background:#1e293b; color:#fff; border: 1px solid #999; padding: 4px 5px; text-align:left; font-size: 9px; }}
      table.v td {{ border: 1px solid #ccc; padding: 4px 5px; font-size: 9px; }}
      table.v td.r, table.v th.r {{ text-align:right; font-family: monospace; }}
      table.v tr.total td {{ font-weight: bold; border-top: 1.5px solid #333; background:#f7f7f7; }}
      .ftr {{ margin-top: 16px; text-align:center; font-size: 7px; color:#777; }}
    </style></head><body>
      <div class="hd">
        <h1>{_html.escape((settings.get('school_name') or 'BALAJI CONVENT').upper())}</h1>
        <div class="sub">{_html.escape(settings.get('school_address') or '')}</div>
        <div class="sub">{_html.escape(contact_line)}</div>
      </div>
      <div class="title">Debit Voucher Report</div>
      <div class="meta">Period: {_html.escape(period)} | Generated: {now_iso()[:16].replace('T',' ')} | By: {_html.escape(user['name'])}</div>
      <table class="v">
        <thead><tr><th>S.No.</th><th>Voucher No.</th><th>Date</th><th>Description / Purpose</th><th>Created By</th><th class="r">Amount</th></tr></thead>
        <tbody>{body_rows}</tbody>
        <tr class="total"><td colspan="5" class="r">TOTAL DEBIT VOUCHERS</td><td class="r">{_inr(total)}</td></tr>
      </table>
      <div class="ftr">Balaji Convent - School Management System<br/>This is a computer generated report.</div>
    </body></html>"""

    buf = io.BytesIO()
    pisa.CreatePDF(html_str, dest=buf)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="Debit-Voucher-Report-{date_from or "all"}_{date_to or "all"}.pdf"'})


@router.get("/reports/vouchers/export")
async def voucher_report_export(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    voucher_no: Optional[str] = None, created_by: Optional[str] = None,
    format: str = "xlsx", user=Depends(get_current_user),
):
    from fastapi.responses import Response

    rows = await _voucher_rows(date_from, date_to, voucher_no, created_by)
    total = round(sum(v["amount"] for v in rows), 2)

    if format == "csv":
        import io, csv as _csv
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["Debit Voucher Report", f"{date_from or ''} to {date_to or ''}"])
        w.writerow([])
        w.writerow(["S.No", "Voucher No.", "Date", "Description / Purpose", "Created By", "Amount"])
        for i, v in enumerate(rows, 1):
            w.writerow([i, v["voucher_no"], v["date"], v["description"], v["created_by"], v["amount"]])
        w.writerow(["", "", "", "", "TOTAL DEBIT VOUCHERS", total])
        return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                         headers={"Content-Disposition": f'attachment; filename="Debit_Voucher_Report_{date_from or "all"}_{date_to or "all"}.csv"'})

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Debit Vouchers"
        bold = Font(bold=True)
        ws.append(["Debit Voucher Report", f"{date_from or ''} to {date_to or ''}"])
        ws["A1"].font = Font(bold=True, size=13)
        ws.append([])
        header_row = ["S.No", "Voucher No.", "Date", "Description / Purpose", "Created By", "Amount"]
        ws.append(header_row)
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for i, v in enumerate(rows, 1):
            ws.append([i, v["voucher_no"], v["date"], v["description"], v["created_by"], v["amount"]])
        ws.append(["", "", "", "", "TOTAL DEBIT VOUCHERS", total])
        ws[f"E{ws.max_row}"].font = bold; ws[f"F{ws.max_row}"].font = bold
        for idx, w in enumerate([7, 18, 14, 34, 20, 14], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": f'attachment; filename="Debit_Voucher_Report_{date_from or "all"}_{date_to or "all"}.xlsx"'})

    raise HTTPException(400, f"Unknown format '{format}' - use csv or xlsx")
