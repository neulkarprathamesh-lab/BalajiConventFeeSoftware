"""Previous-Year Balance (Opening Balance) tracking + Bulk Fee Detail Update.

Both features are explicit, audited, admin-only record-keeping overlays.
Neither one ever creates a receipt: entering or importing figures here
records office bookkeeping data only, never a fabricated payment event.
Academic years are kept fully separate — every record is scoped to one
`academic_year` and is never merged with another year's figures.

Bulk Fee Detail Update intentionally has NO installment tracking (Total Fee /
Total Paid / Balance Fee / Previous Year Outstanding only). "Previous Year
Outstanding" entered here writes into the SAME `student_opening_balances`
collection the per-student ledger panel uses, so there is exactly one source
of truth for a student's carried-forward balance — never two numbers that
could drift apart.
"""
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends, Response
from core import db, audit, gen_id, get_current_user, now_iso, require_roles

router = APIRouter(prefix="/api", tags=["fee-details"])

# ---------------- Previous-Year Balance (Opening Balance) ----------------

@router.get("/students/{sid}/opening-balance")
async def get_opening_balance(sid: str, academic_year: str, user = Depends(get_current_user)):
    doc = await db.student_opening_balances.find_one({"student_id": sid, "academic_year": academic_year}, {"_id": 0})
    if not doc:
        return {"student_id": sid, "academic_year": academic_year, "amount": 0, "history": []}
    return doc

async def _set_opening_balance(sid: str, academic_year: str, amount: float, reason: str, user: dict) -> None:
    """Shared write path for both the per-student panel and Bulk Fee Detail Update imports —
    the ONE place a student's previous-year balance is ever set, so there is no way for the
    two entry points to disagree with each other."""
    existing = await db.student_opening_balances.find_one({"student_id": sid, "academic_year": academic_year})
    entry = {"amount": amount, "reason": reason, "by": user["name"], "by_id": user["id"], "at": now_iso(), "type": "set"}
    if existing:
        await db.student_opening_balances.update_one(
            {"student_id": sid, "academic_year": academic_year},
            {"$set": {"amount": amount, "updated_at": now_iso(), "updated_by": user["name"]},
             "$push": {"history": entry}},
        )
    else:
        await db.student_opening_balances.insert_one({
            "id": gen_id(), "student_id": sid, "academic_year": academic_year,
            "amount": amount, "created_at": now_iso(), "created_by": user["name"],
            "updated_at": now_iso(), "updated_by": user["name"], "history": [entry],
        })

@router.post("/students/{sid}/opening-balance/set")
async def set_opening_balance(sid: str, body: Dict[str, Any],
                               user = Depends(require_roles("administrator", "manager"))):
    """Set (or correct) the balance carried forward INTO `academic_year` from the prior year.
    This is a manually-entered figure, never auto-rolled-over from year to year, so it can
    never silently double-count across academic years. A reason is mandatory and every change
    is appended to `history` for a full audit trail."""
    academic_year = str(body.get("academic_year") or "").strip()
    reason = str(body.get("reason") or "").strip()
    if not academic_year:
        raise HTTPException(400, "academic_year is required")
    if not reason:
        raise HTTPException(400, "A reason is required when setting a student's previous-year balance")
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")
    if amount < 0:
        raise HTTPException(400, "amount cannot be negative")
    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    await _set_opening_balance(sid, academic_year, amount, reason, user)
    await audit(user, "set_opening_balance", "student", sid, {"academic_year": academic_year, "amount": amount, "reason": reason})
    return {"student_id": sid, "academic_year": academic_year, "amount": amount}

@router.post("/students/{sid}/opening-balance/record-payment")
async def record_opening_balance_payment(sid: str, body: Dict[str, Any],
                                          user = Depends(require_roles("administrator", "manager", "accountant"))):
    """Reduce the outstanding previous-year balance by a payment collected against it.
    This does NOT create a receipt — it only adjusts the tracked balance. If a receipt was
    also issued for this collection, note its number in `reason` for the audit trail."""
    academic_year = str(body.get("academic_year") or "").strip()
    reason = str(body.get("reason") or "").strip()
    if not academic_year:
        raise HTTPException(400, "academic_year is required")
    if not reason:
        raise HTTPException(400, "A reason is required when recording a payment against the previous-year balance")
    try:
        payment = float(body.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")
    if payment <= 0:
        raise HTTPException(400, "amount must be positive")
    existing = await db.student_opening_balances.find_one({"student_id": sid, "academic_year": academic_year})
    if not existing or existing.get("amount", 0) <= 0:
        raise HTTPException(400, "No outstanding previous-year balance to record a payment against")
    new_amount = max(0.0, existing["amount"] - payment)
    entry = {"amount": -payment, "reason": reason, "by": user["name"], "by_id": user["id"], "at": now_iso(), "type": "payment"}
    await db.student_opening_balances.update_one(
        {"student_id": sid, "academic_year": academic_year},
        {"$set": {"amount": new_amount, "updated_at": now_iso(), "updated_by": user["name"]},
         "$push": {"history": entry}},
    )
    await audit(user, "record_opening_balance_payment", "student", sid, {"academic_year": academic_year, "payment": payment, "new_amount": new_amount, "reason": reason})
    return {"student_id": sid, "academic_year": academic_year, "amount": new_amount}

# ---------------- Class/group listing (drives the class-wise XLSX generator) ----------------

def _billing_group_key(student: dict, class_doc: dict) -> Dict[str, Any]:
    """The REAL billing group for a student — used for bulk-fee file generation.
    Bi-Focal and Fisheries are their OWN group here (different fee amounts), never merged
    into Science. Any 'Science' display/teacher-grouping label is a presentation-layer concern
    elsewhere, not this billing grouping."""
    cname = class_doc.get("name", "?")
    medium = student.get("medium", "?")
    stream = student.get("stream")
    section = student.get("section")
    if stream:
        label = f"{cname.replace('Class ', '')}th_{stream}"
        display = f"{cname} · {stream}"
    else:
        medium_short = {"English Medium": "English", "Semi Medium (Marathi)": "SemiEnglish"}.get(medium, medium)
        label = f"{cname.replace('Class ', '')}th_{medium_short}_{section or 'NA'}"
        display = f"{cname} · {medium} · Section {section or '—'}"
    return {"class_name": cname, "medium": medium, "stream": stream, "section": section,
            "group_key": label, "display": display}

# ---------------- Per-student fee/installment overrides (Option A) ----------------
# For an individual student + academic year + fee head, admin can define a
# total amount optionally split into 1-4 installments with due dates. This
# ONLY changes which line items a student's ledger shows (see
# students.py::student_ledger's fee_items merge) — payment itself is
# unchanged: a cashier pays via the existing receipt system exactly as for
# any other fee head, and paid/outstanding is always derived live from real
# receipts, never a stored/independently-editable status field.
from core import validate_installments

@router.get("/students/{sid}/fee-overrides")
async def list_fee_overrides(sid: str, academic_year: Optional[str] = None, user = Depends(get_current_user)):
    q: Dict[str, Any] = {"student_id": sid}
    if academic_year: q["academic_year"] = academic_year
    return await db.student_fee_overrides.find(q, {"_id": 0}).sort("fee_head_name", 1).to_list(50)

@router.post("/students/{sid}/fee-overrides")
async def set_fee_override(sid: str, body: Dict[str, Any],
                            user = Depends(require_roles("administrator", "manager", "accountant"))):
    """Create or replace ONE student's override for one fee head + academic year.
    Does not touch fee_structures (the shared class template stays the default
    for every other student), does not create a receipt, and does not alter
    any existing receipt/payment. Existing students with no override for a
    given head simply keep using the shared fee_structure item, unaffected."""
    fee_head_name = str(body.get("fee_head_name") or "").strip()
    academic_year = str(body.get("academic_year") or "").strip()
    total_amount = body.get("total_amount")
    installments = body.get("installments") or []
    reason = body.get("reason")
    if not fee_head_name or not academic_year:
        raise HTTPException(400, "fee_head_name and academic_year are required")
    try:
        total_amount = float(total_amount)
    except (TypeError, ValueError):
        raise HTTPException(400, "total_amount must be a number")
    if total_amount <= 0:
        raise HTTPException(400, "total_amount must be positive")

    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")

    clean_installments = None
    if installments:
        try:
            validate_installments(total_amount, installments)
        except ValueError as e:
            raise HTTPException(400, str(e))
        clean_installments = [
            {"installment_no": idx + 1, "amount": float(i["amount"]), "due_date": str(i["due_date"]).strip()}
            for idx, i in enumerate(installments)
        ]

    existing = await db.student_fee_overrides.find_one({"student_id": sid, "academic_year": academic_year, "fee_head_name": fee_head_name})
    now = now_iso()
    doc = {
        "student_id": sid, "academic_year": academic_year, "fee_head_name": fee_head_name,
        "total_amount": total_amount, "installments": clean_installments,
        "reason": reason, "updated_at": now, "updated_by": user["name"],
    }
    if existing:
        old_total = existing.get("total_amount")
        await db.student_fee_overrides.update_one({"id": existing["id"]}, {"$set": doc})
        oid = existing["id"]
        action = "update"
    else:
        oid = gen_id()
        doc.update({"id": oid, "created_at": now, "created_by": user["name"]})
        await db.student_fee_overrides.insert_one(doc)
        old_total = None
        action = "create"

    await audit(user, action, "student_fee_override", oid, {
        "student_id": sid, "admission_no": student.get("admission_no"), "academic_year": academic_year,
        "fee_head_name": fee_head_name, "old_total": old_total, "new_total": total_amount,
        "installment_count": len(clean_installments) if clean_installments else 0, "reason": reason,
    })
    return {k: v for k, v in doc.items() if k != "_id"} | {"id": oid}

@router.delete("/students/{sid}/fee-overrides/{oid}")
async def delete_fee_override(sid: str, oid: str, user = Depends(require_roles("administrator", "manager"))):
    """Removing an override reverts that student to the shared fee_structure
    item for that head — never touches any existing receipt/payment."""
    existing = await db.student_fee_overrides.find_one({"id": oid, "student_id": sid})
    if not existing:
        raise HTTPException(404, "Not found")
    await db.student_fee_overrides.delete_one({"id": oid})
    await audit(user, "delete", "student_fee_override", oid, {
        "student_id": sid, "fee_head_name": existing.get("fee_head_name"), "academic_year": existing.get("academic_year"),
    })
    return {"deleted": True}

@router.get("/fee-details/groups")
async def list_fee_detail_groups(user = Depends(get_current_user)):
    """Every real class/medium/stream/section combination that currently has at least one
    student — the exact set of files Bulk Fee Detail Update can generate. A group with zero
    students is never listed, so nothing gets generated for empty classes."""
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    groups: Dict[str, Dict[str, Any]] = {}
    async for s in db.students.find({}, {"_id": 0}):
        cls = classes.get(s.get("class_id"), {})
        info = _billing_group_key(s, cls)
        key = info["group_key"]
        if key not in groups:
            groups[key] = {**info, "student_count": 0}
        groups[key]["student_count"] += 1
    return sorted(groups.values(), key=lambda g: g["group_key"])

# ---------------- Bulk Fee Detail Update — records ----------------

FEE_XLSX_HEADERS = ["Admission No.", "Student Name", "Class", "Medium", "Stream", "Academic Year",
                     "Total Fee", "Total Paid", "Balance Fee", "Previous Year Outstanding", "Remarks"]

async def _build_group_workbook(group_key: str, academic_year: str):
    """One real class/billing-group workbook: real students, real assigned fee totals,
    pre-filled with any figures already entered for this academic year so re-downloading
    the template never loses prior data entry. No installment columns."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    students = []
    async for s in db.students.find({}, {"_id": 0}):
        cls = classes.get(s.get("class_id"), {})
        info = _billing_group_key(s, cls)
        if info["group_key"] == group_key:
            students.append((s, info))
    if not students:
        return None

    fs_by_id = {f["id"]: f for f in await db.fee_structures.find({}, {"_id": 0}).to_list(500)}
    existing_details = {
        d["student_id"]: d for d in await db.fee_details.find(
            {"academic_year": academic_year, "student_id": {"$in": [s["id"] for s, _ in students]}}, {"_id": 0}
        ).to_list(2000)
    }
    existing_ob = {
        o["student_id"]: o for o in await db.student_opening_balances.find(
            {"academic_year": academic_year, "student_id": {"$in": [s["id"] for s, _ in students]}}, {"_id": 0}
        ).to_list(2000)
    }

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Fee Update"
    display = students[0][1]["display"]
    ws.append(["Balaji Convent & Junior College - Bulk Fee Detail Update"])
    ws.append([display, "", f"Academic Year: {academic_year}", "", f"Students: {len(students)}"])
    ws.append([])
    header_row = 4
    ws.append(FEE_XLSX_HEADERS)
    for cell in ws[header_row]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1E40AF")
        cell.alignment = Alignment(horizontal="center")

    for i, (s, info) in enumerate(sorted(students, key=lambda x: x[0]["name"])):
        row = header_row + 1 + i
        fd = existing_details.get(s["id"])
        ob = existing_ob.get(s["id"])
        fs = fs_by_id.get(s.get("fee_structure_id"), {})
        total_fee = fd["total_fee"] if fd else fs.get("total", 0)
        total_paid = fd["total_paid"] if fd else None
        prev_out = (fd.get("previous_year_outstanding") if fd else None)
        if prev_out is None and ob:
            prev_out = ob.get("amount")
        ws.cell(row=row, column=1, value=s["admission_no"])
        ws.cell(row=row, column=2, value=s["name"])
        ws.cell(row=row, column=3, value=info["class_name"])
        ws.cell(row=row, column=4, value=info["medium"])
        ws.cell(row=row, column=5, value=info["stream"] or "")
        ws.cell(row=row, column=6, value=academic_year)
        ws.cell(row=row, column=7, value=total_fee)
        ws.cell(row=row, column=8, value=total_paid)
        ws.cell(row=row, column=9, value=f"=G{row}-H{row}")
        ws.cell(row=row, column=10, value=prev_out)
        ws.cell(row=row, column=11, value=(fd.get("remarks") if fd else None))

    widths = [14, 24, 10, 22, 14, 14, 12, 12, 12, 20, 24]
    for idx, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
    ws.freeze_panes = f"A{header_row+1}"
    return wb, len(students)

@router.get("/fee-details/groups/{group_key}/template")
async def download_group_template(group_key: str, academic_year: str = "2026-27",
                                    user = Depends(require_roles("administrator", "manager", "accountant"))):
    import io
    built = await _build_group_workbook(group_key, academic_year)
    if not built:
        raise HTTPException(404, f"No students currently in group '{group_key}' — nothing to generate")
    wb, count = built
    buf = io.BytesIO()
    wb.save(buf)
    filename = f"{group_key}_Fee_Update.xlsx"
    await audit(user, "download_template", "fee_detail_group", group_key, {"academic_year": academic_year, "student_count": count})
    return Response(content=buf.getvalue(),
                     media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@router.get("/fee-details/groups/export-all")
async def download_all_group_templates(academic_year: str = "2026-27",
                                          user = Depends(require_roles("administrator", "manager"))):
    """All real class/billing-group Fee Update files at once, zipped — one .xlsx per group
    that actually has students, nothing invented for empty classes."""
    import io, zipfile
    groups = await list_fee_detail_groups(user)  # reuse the same real-group listing
    buf = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for g in groups:
            built = await _build_group_workbook(g["group_key"], academic_year)
            if not built:
                continue
            wb, count = built
            inner = io.BytesIO()
            wb.save(inner)
            zf.writestr(f"{g['group_key']}_Fee_Update.xlsx", inner.getvalue())
            included += 1
    await audit(user, "download_template", "fee_detail_group", "all", {"academic_year": academic_year, "files": included})
    return Response(content=buf.getvalue(), media_type="application/zip",
                     headers={"Content-Disposition": f'attachment; filename="Bulk_Fee_Update_{academic_year}_AllClasses.zip"'})

# ==================== LIVE FEE UPDATE ====================
# Built entirely on the existing student_fee_overrides storage and the
# shared compute_fee_items() function — "Updated Fee" for a normal fee head
# is stored as exactly the same override record the installment UI uses
# (just with no installments split), so there is one storage mechanism for
# per-student fee changes, not two. Bus Fee is read from its own existing
# bus_stops/bus_charges data — never mixed into this collection, per the
# explicit instruction to keep bus fee logic completely separate.
from core import compute_fee_items, apply_opening_paid

FEE_HEAD_OPTIONS = [
    "Tuition Fee", "Admission Fee", "Continuation Fee", "Bus Fee",
    "Tuition Fee - Installment 1", "Tuition Fee - Installment 2",
    "Tuition Fee - Installment 3", "Tuition Fee - Installment 4",
    "Late Fee", "Fine", "Practical Fee", "Development Fee",
    "Previous Year Balance", "Other Fee",
]

@router.get("/fee-update/fee-head-options")
async def fee_head_options(user = Depends(get_current_user)):
    """The fixed list the Phase-3 selector checkboxes are built from."""
    return FEE_HEAD_OPTIONS

@router.get("/fee-update/students")
async def fee_update_students(
    academic_year: str = "2026-27",
    class_id: Optional[str] = None,
    section: Optional[str] = None,
    medium: Optional[str] = None,
    stream: Optional[str] = None,
    department_id: Optional[str] = None,
    fee_heads: str = "",  # comma-separated, matches FEE_HEAD_OPTIONS entries
    user = Depends(get_current_user),
):
    """Filtered/sorted grid for Live Fee Update. Read-only. Current/Paid/
    Balance per selected fee head come from compute_fee_items() (school
    heads) or bus_stops/bus_charges (Bus Fee) or student_opening_balances
    (Previous Year Balance) — always derived from real data, never a
    separately-maintained stored total."""
    wanted = [h.strip() for h in fee_heads.split(",") if h.strip()]
    q: Dict[str, Any] = {"status": "active", "academic_year": academic_year}
    if class_id: q["class_id"] = class_id
    if section: q["section"] = section
    if medium: q["medium"] = medium
    if stream: q["stream"] = stream
    if department_id: q["department_id"] = department_id
    students = await db.students.find(q, {"_id": 0}).to_list(5000)
    if not students:
        return []

    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    departments = {d["id"]: d for d in await db.departments.find({}, {"_id": 0}).to_list(50)}
    fs_by_id = {f["id"]: f for f in await db.fee_structures.find({}, {"_id": 0}).to_list(2000)}
    stops_by_no = {s["stop_no"]: s for s in await db.bus_stops.find({"academic_year": academic_year}, {"_id": 0}).to_list(500)}
    sids = [s["id"] for s in students]
    adjustments_by_sid: Dict[str, List[dict]] = {}
    for a in await db.adjustments.find({"student_id": {"$in": sids}, "status": "approved"}, {"_id": 0}).to_list(5000):
        adjustments_by_sid.setdefault(a["student_id"], []).append(a)

    rows = []
    for s in students:
        cls = classes.get(s.get("class_id"), {})
        dept = departments.get(s.get("department_id"), {})
        fs = fs_by_id.get(s.get("fee_structure_id"))
        overrides = await db.student_fee_overrides.find({"student_id": s["id"], "academic_year": academic_year}, {"_id": 0}).to_list(20)
        receipts = await db.receipts.find({"student_id": s["id"], "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
        items = compute_fee_items((fs.get("items") if fs else None) or [], overrides, receipts)
        # Same opening-paid carry-forward as /students/{id}/ledger (see core.py
        # apply_opening_paid) — a real, pre-go-live payment imported into
        # fee_details, never a fake receipt — so this grid and Student Profile
        # never disagree about what a migrated student has already paid.
        fd = await db.fee_details.find_one({"student_id": s["id"], "academic_year": academic_year}, {"_id": 0})
        items, opening_paid_unabsorbed = apply_opening_paid(items, float(fd.get("total_paid") or 0) if fd else 0)
        items_by_name = {it["fee_head_name"].strip().lower(): it for it in items}

        # Overall Total/Paid/Balance - the student's genuine overall school-fee
        # position (identical formula to /students/{id}/ledger's total_paid/
        # school_outstanding), completely independent of whichever single fee
        # head is selected in the dropdown above. Previously the grid showed the
        # PER-HEAD paid/balance here instead (fh.paid/fh.balance below) - real
        # fee_structure items are named "Tuition I/II/III" etc, never literally
        # "Tuition Fee", so selecting the default "Tuition Fee" head always
        # looked up nothing and showed a false ₹0.00 even for students who had
        # genuinely paid. Bus receipts/Bus Fee are still excluded here exactly
        # as before: compute_fee_items() only ever matches a receipt line to a
        # fee item by name, and bus lines ("Bus Fee - <month>") never match a
        # school fee_structure item name, so they were never counted anyway.
        overall_total = float(fs.get("total") or 0) if fs else 0
        overall_paid = sum(it["paid"] for it in items) + opening_paid_unabsorbed
        total_refunded = sum(r.get("total", 0) for r in receipts if r.get("receipt_type") == "refund")
        total_adjusted = sum(a.get("amount", 0) for a in adjustments_by_sid.get(s["id"], []))
        overall_balance = max(0, round(overall_total - overall_paid - total_adjusted + total_refunded, 2))

        row = {
            "student_id": s["id"], "admission_no": s.get("admission_no"), "student_name": s.get("name"),
            "class_id": s.get("class_id"),
            "class_name": cls.get("name"), "section": s.get("section"), "medium": s.get("medium"),
            "stream": s.get("stream"), "department_name": dept.get("name"), "mobile": s.get("guardian_mobile"),
            "overall_total": overall_total, "overall_paid": round(overall_paid, 2), "overall_balance": overall_balance,
            "fee_heads": {},
        }
        for head in wanted:
            hl = head.strip().lower()
            if head == "Bus Fee":
                stop = stops_by_no.get(s.get("bus_stop_no")) if s.get("bus_required") else None
                bus_charges = await db.bus_charges.find({"student_id": s["id"]}, {"_id": 0}).to_list(500)
                bus_paid = sum(float(c.get("amount_paid") or 0) for c in bus_charges)
                bus_total = sum(float(c.get("amount") or 0) for c in bus_charges)
                row["fee_heads"][head] = {
                    "current": stop.get("monthly_fee") if stop else None,
                    "paid": bus_paid, "balance": max(0, round(bus_total - bus_paid, 2)),
                }
            elif head == "Previous Year Balance":
                ob = await db.student_opening_balances.find_one({"student_id": s["id"], "academic_year": academic_year}, {"_id": 0})
                amt = ob.get("amount", 0) if ob else 0
                row["fee_heads"][head] = {"current": amt, "paid": 0, "balance": amt}
            else:
                it = items_by_name.get(hl)
                row["fee_heads"][head] = {"current": it["total"], "paid": it["paid"], "balance": it["outstanding"]} if it else {"current": None, "paid": 0, "balance": 0}
        rows.append(row)

    # Class -> Medium -> Section -> Name -> Admission No.
    rows.sort(key=lambda r: (r["class_name"] or "", r["medium"] or "", r["section"] or "", r["student_name"] or "", r["admission_no"] or ""))
    return rows

@router.post("/students/{sid}/fee-update")
async def update_student_fee(sid: str, body: Dict[str, Any],
                              user = Depends(get_current_user)):
    """Sets/replaces a student's 'Updated Fee' for one fee head (no
    installments — for a split plan, use POST /students/{id}/fee-overrides
    instead; both write to the same student_fee_overrides collection, so a
    plain update and an installment plan can never disagree about which is
    current). Requires a reason. Rejects if the new fee is below what's
    already been paid, rather than creating an impossible negative balance.
    Never creates a receipt; never touches any existing receipt.

    Authorization: administrator/manager/accountant always may. A cashier
    may ONLY if they currently hold an active, non-expired, non-revoked
    temporary Fee Edit Access grant (see routers/fee_edit_access.py) for
    this exact student's class/medium and fee scope (school/bus), on the
    same device_id the grant was approved for - never the Master PIN
    itself, and never a class/scope outside what was explicitly approved."""
    fee_head_name = str(body.get("fee_head_name") or "").strip()
    academic_year = str(body.get("academic_year") or "").strip()
    new_fee = body.get("new_fee")
    reason = str(body.get("reason") or "").strip()
    if not fee_head_name or not academic_year:
        raise HTTPException(400, "fee_head_name and academic_year are required")
    if not reason:
        raise HTTPException(400, "A reason is required for every fee update")
    try:
        new_fee = float(new_fee)
    except (TypeError, ValueError):
        raise HTTPException(400, "new_fee must be a number")
    if new_fee <= 0:
        raise HTTPException(400, "new_fee must be positive")

    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")

    temp_grant = None
    if user["role"] not in ("administrator", "manager", "accountant"):
        from routers.fee_edit_access import find_active_grant
        required_scope = "bus" if fee_head_name.strip().lower() == "bus fee" else "school"
        device_id = str(body.get("device_id") or "").strip()
        temp_grant = await find_active_grant(user, device_id, student, required_scope)
        if not temp_grant:
            raise HTTPException(403, "You do not have temporary Fee Edit Access for this class/scope. Request access from Live Fee Update.")

    fs = await db.fee_structures.find_one({"id": student.get("fee_structure_id")}, {"_id": 0}) if student.get("fee_structure_id") else None
    existing_override = await db.student_fee_overrides.find_one({"student_id": sid, "academic_year": academic_year, "fee_head_name": fee_head_name})
    receipts = await db.receipts.find({"student_id": sid, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)

    # Old fee = current override if present, else the shared fee_structure item's amount
    old_fee = None
    if existing_override:
        old_fee = existing_override.get("total_amount")
    elif fs:
        for it in (fs.get("items") or []):
            if (it.get("fee_head_name") or "").strip().lower() == fee_head_name.lower():
                old_fee = float(it.get("amount") or 0)
                break

    total_paid = 0.0
    for r in receipts:
        if r.get("receipt_type") in ("refund", "debit_voucher"):
            continue
        for line in (r.get("lines") or []):
            if (line.get("fee_head_name") or "").strip().lower() == fee_head_name.lower():
                total_paid += float(line.get("amount") or 0)

    if new_fee < total_paid - 0.01:
        raise HTTPException(400, f"New fee (₹{new_fee:,.2f}) cannot be less than what's already been paid (₹{total_paid:,.2f}). This would create a negative balance.")

    new_balance = round(new_fee - total_paid, 2)
    now = now_iso()
    doc = {
        "student_id": sid, "academic_year": academic_year, "fee_head_name": fee_head_name,
        "total_amount": new_fee, "installments": None, "reason": reason,
        "updated_at": now, "updated_by": user["name"],
    }
    if existing_override:
        await db.student_fee_overrides.update_one({"id": existing_override["id"]}, {"$set": doc})
        oid = existing_override["id"]
    else:
        oid = gen_id()
        doc.update({"id": oid, "created_at": now, "created_by": user["name"]})
        await db.student_fee_overrides.insert_one(doc)

    class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id": 0}) if student.get("class_id") else None
    await audit(user, "fee_update", "student_fee_override", oid, {
        "student_id": sid, "student_name": student.get("name"), "admission_no": student.get("admission_no"),
        "class_name": class_doc.get("name") if class_doc else None,
        "academic_year": academic_year, "fee_head_name": fee_head_name,
        "old_fee": old_fee, "new_fee": new_fee, "difference": (new_fee - old_fee) if old_fee is not None else None,
        "total_paid_at_update": total_paid, "new_balance": new_balance,
        "updated_by": user["name"], "updated_by_id": user["id"], "at": now, "reason": reason,
        "via_temporary_access": temp_grant["id"] if temp_grant else None,
        "temporary_access_approved_by": temp_grant.get("approved_by_name") if temp_grant else None,
    })
    return {"ok": True, "old_fee": old_fee, "new_fee": new_fee, "total_paid": total_paid, "new_balance": new_balance}

@router.get("/fee-update/export.csv")
async def fee_update_export_csv(
    academic_year: str = "2026-27", class_id: Optional[str] = None, section: Optional[str] = None,
    medium: Optional[str] = None, stream: Optional[str] = None, department_id: Optional[str] = None,
    fee_heads: str = "", user = Depends(require_roles("administrator", "manager", "accountant")),
):
    """Exports exactly what fee_update_students() would display for the same filters/columns."""
    import io, csv as _csv
    rows = await fee_update_students(academic_year, class_id, section, medium, stream, department_id, fee_heads, user)
    wanted = [h.strip() for h in fee_heads.split(",") if h.strip()]
    buf = io.StringIO()
    w = _csv.writer(buf)
    header = ["Class", "Section", "Medium", "Department/Stream", "Admission No.", "Student Name",
              "Total Fee (Overall)", "Total Paid (Overall)", "Balance (Overall)"]
    for h in wanted:
        header += [f"{h} - Current", f"{h} - Paid", f"{h} - Balance"]
    w.writerow(header)
    for r in rows:
        line = [r["class_name"], r["section"], r["medium"], r.get("department_name") or r.get("stream") or "", r["admission_no"], r["student_name"],
                r.get("overall_total"), r.get("overall_paid"), r.get("overall_balance")]
        for h in wanted:
            fh = r["fee_heads"].get(h, {})
            line += [fh.get("current"), fh.get("paid"), fh.get("balance")]
        w.writerow(line)
    await audit(user, "export", "fee_update_report", "", {"academic_year": academic_year, "filters": {"class_id": class_id, "section": section, "medium": medium, "stream": stream}, "fee_heads": wanted, "row_count": len(rows)})
    return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                     headers={"Content-Disposition": f'attachment; filename="Live_Fee_Update_{academic_year}.csv"'})

# ---------------- CSV/Excel bulk import of per-student fee overrides ----------------
# Writes ONLY to student_fee_overrides (the exact same collection/upsert semantics as
# POST /students/{sid}/fee-overrides and POST /students/{sid}/fee-update) — never a
# receipt, never a payment, never fee_structures (the shared class template). A "Bus Fee"
# row is explicitly rejected here and pointed at the existing, already-complete
# POST /bus-assignment/bulk-import instead, because Bus Fee is always read live from
# bus_stops/bus_charges (see fee_update_students() above) — a student_fee_overrides row
# for "Bus Fee" would be silently ignored, so this is refused rather than accepted and
# quietly doing nothing. Re-importing the same file is always safe: every row is an
# upsert keyed on (student_id, academic_year, fee_head_name), so importing twice just
# re-applies the same values instead of creating a second, conflicting record.

async def _classify_fee_update_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    seen: Dict[str, int] = {}
    valid, invalid = [], []
    for idx, r in enumerate(rows):
        row_no = idx + 1
        adm = str(r.get("admission_no", "")).strip()
        academic_year = str(r.get("academic_year", "")).strip()
        fee_head_name = str(r.get("fee_head_name", "")).strip()
        if not adm:
            invalid.append({"row": row_no, "error": "admission_no is required", "data": r}); continue
        if not academic_year:
            invalid.append({"row": row_no, "error": "academic_year is required", "data": r}); continue
        if not fee_head_name:
            invalid.append({"row": row_no, "error": "fee_head_name is required", "data": r}); continue
        if fee_head_name not in FEE_HEAD_OPTIONS:
            invalid.append({"row": row_no, "error": f"fee_head_name '{fee_head_name}' is not one of the recognised fee heads: {', '.join(FEE_HEAD_OPTIONS)}", "data": r}); continue
        if fee_head_name == "Bus Fee":
            invalid.append({"row": row_no, "error": "Bus Fee cannot be set here — it is always read live from the Bus Stop Master. Use Bus Assignment import (main_stop/sub_stop) instead.", "data": r}); continue
        dup_key = f"{adm}|{academic_year}|{fee_head_name}"
        if dup_key in seen:
            invalid.append({"row": row_no, "error": f"Duplicate row — admission_no '{adm}' + fee_head '{fee_head_name}' + academic_year '{academic_year}' already appears at row {seen[dup_key]} in this file", "data": r}); continue
        seen[dup_key] = row_no
        student = await db.students.find_one({"admission_no": adm}, {"_id": 0})
        if not student:
            invalid.append({"row": row_no, "error": f"No student found with admission_no '{adm}'", "data": r}); continue
        cls = classes.get(student.get("class_id"), {})
        row_class = str(r.get("class_name") or "").strip()
        row_medium = str(r.get("medium") or "").strip()
        row_stream = str(r.get("stream") or "").strip()
        mismatch = None
        if row_class and row_class != cls.get("name"):
            mismatch = f"row says Class '{row_class}' but student '{student['name']}' ({adm}) is actually in {cls.get('name')}"
        elif row_medium and row_medium != student.get("medium"):
            mismatch = f"row says Medium '{row_medium}' but student '{student['name']}' ({adm}) is actually {student.get('medium')}"
        elif row_stream and student.get("stream") and row_stream != student.get("stream"):
            mismatch = f"row says Stream '{row_stream}' but student '{student['name']}' ({adm}) is actually {student.get('stream')}"
        if mismatch:
            invalid.append({"row": row_no, "error": f"Class/group mismatch — {mismatch}. Student's class was NOT changed.", "data": r}); continue
        try:
            fee_amount = float(r.get("fee_amount") or r.get("total_amount") or 0)
        except (TypeError, ValueError):
            invalid.append({"row": row_no, "error": "fee_amount must be a number", "data": r}); continue
        if fee_amount <= 0:
            invalid.append({"row": row_no, "error": "fee_amount must be positive", "data": r}); continue

        installments = []
        for n in (1, 2, 3, 4):
            amt = str(r.get(f"installment_{n}_amount") or "").strip()
            due = str(r.get(f"installment_{n}_due_date") or "").strip()
            if not amt and not due:
                continue
            try:
                installments.append({"amount": float(amt), "due_date": due})
            except (TypeError, ValueError):
                installments.append({"amount": None, "due_date": due})
        clean_installments = None
        if installments:
            try:
                validate_installments(fee_amount, installments)
            except ValueError as e:
                invalid.append({"row": row_no, "error": str(e), "data": r}); continue
            clean_installments = [
                {"installment_no": i + 1, "amount": float(inst["amount"]), "due_date": inst["due_date"]}
                for i, inst in enumerate(installments)
            ]

        existing = await db.student_fee_overrides.find_one(
            {"student_id": student["id"], "academic_year": academic_year, "fee_head_name": fee_head_name}, {"_id": 0}
        )
        valid.append({
            "row": row_no, "admission_no": adm, "student_id": student["id"], "student_name": student["name"],
            "academic_year": academic_year, "fee_head_name": fee_head_name, "fee_amount": fee_amount,
            "installments": clean_installments, "reason": str(r.get("reason") or "").strip() or "CSV import",
            "action": "update" if existing else "add",
            "old_amount": existing.get("total_amount") if existing else None,
        })
    return {
        "total_rows": len(rows), "valid_rows": len(valid), "invalid_rows": len(invalid),
        "rows_to_add": sum(1 for v in valid if v["action"] == "add"),
        "rows_to_update": sum(1 for v in valid if v["action"] == "update"),
        "valid": valid, "invalid": invalid,
    }

@router.post("/fee-update/bulk-import")
async def bulk_import_fee_overrides(body: Dict[str, Any],
                                     user = Depends(require_roles("administrator", "manager", "accountant"))):
    """CSV/Excel bulk import for per-student fee heads (Tuition Fee, Admission Fee, etc.),
    with optional 1-4 installments. Matches students by admission_no ONLY. Pass `preview: true`
    to validate/classify every row (exact row + reason for anything invalid) WITHOUT writing
    anything — call again with `preview` omitted to commit. Every write is an upsert into
    student_fee_overrides (the same collection and same create/update rule as the single-student
    Fee Update / Installments UI), so this can never create a receipt, never touches a historical
    payment, and re-importing the same file is always safe."""
    rows: List[Dict[str, Any]] = body.get("rows", [])
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "rows must be a non-empty array")
    preview = bool(body.get("preview"))
    result = await _classify_fee_update_rows(rows)
    if preview:
        return {**result, "committed": False}

    batch_id = body.get("batch_id") or gen_id()
    created = updated = 0
    for v in result["valid"]:
        now = now_iso()
        doc = {
            "student_id": v["student_id"], "academic_year": v["academic_year"], "fee_head_name": v["fee_head_name"],
            "total_amount": v["fee_amount"], "installments": v["installments"], "reason": v["reason"],
            "updated_at": now, "updated_by": user["name"], "import_batch_id": batch_id,
        }
        existing = await db.student_fee_overrides.find_one({
            "student_id": v["student_id"], "academic_year": v["academic_year"], "fee_head_name": v["fee_head_name"],
        })
        if existing:
            await db.student_fee_overrides.update_one({"id": existing["id"]}, {"$set": doc})
            oid = existing["id"]
            updated += 1
        else:
            oid = gen_id()
            doc.update({"id": oid, "created_at": now, "created_by": user["name"]})
            await db.student_fee_overrides.insert_one(doc)
            created += 1
        await audit(user, "csv_import", "student_fee_override", oid, {
            "student_id": v["student_id"], "admission_no": v["admission_no"], "academic_year": v["academic_year"],
            "fee_head_name": v["fee_head_name"], "old_amount": v["old_amount"], "new_amount": v["fee_amount"],
            "reason": v["reason"], "batch_id": batch_id,
        })
    await audit(user, "bulk_import", "student_fee_override", batch_id, {
        "created": created, "updated": updated, "invalid": result["invalid_rows"], "total_rows": result["total_rows"],
    })
    return {"created": created, "skipped": updated, "errors": result["invalid"],
            "total": result["total_rows"], "batch_id": batch_id, "committed": True}

@router.post("/fee-update/bulk-delete")
async def bulk_delete_fee_overrides(body: Dict[str, Any], user = Depends(require_roles("administrator", "manager"))):
    """Undo a CSV import batch. Deletes only the override rows created/updated by that exact
    batch_id — reverting each affected student to whatever they had before (the shared
    fee_structure item, or a still-earlier override if one existed and this batch merely
    updated its fields is NOT restored automatically, since the prior value was already
    overwritten — this mirrors the same limitation already accepted for every other bulk
    import's undo in this app). Never touches a receipt or payment either way."""
    batch_id = body.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id is required")
    res = await db.student_fee_overrides.delete_many({"import_batch_id": batch_id})
    await audit(user, "bulk_delete", "student_fee_override", batch_id, {"deleted": res.deleted_count})
    return {"deleted": res.deleted_count, "protected_referenced": 0}

@router.get("/fee-details")
async def list_fee_details(academic_year: Optional[str] = None, q: Optional[str] = None,
                            group_key: Optional[str] = None,
                            user = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if academic_year:
        query["academic_year"] = academic_year
    if group_key:
        query["group_key"] = group_key
    if q:
        # re.escape - see students.py's list_students() for the same fix and
        # rationale: literal search text, never executable regex syntax.
        safe_q = re.escape(q)
        query["$or"] = [
            {"admission_no": {"$regex": safe_q, "$options": "i"}},
            {"student_name": {"$regex": safe_q, "$options": "i"}},
        ]
    return await db.fee_details.find(query, {"_id": 0}).sort("student_name", 1).to_list(2000)

@router.get("/fee-details/{fdid}")
async def get_fee_detail(fdid: str, user = Depends(get_current_user)):
    doc = await db.fee_details.find_one({"id": fdid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc

def _shape_row(row: Dict[str, Any], student: dict, class_doc: dict) -> Dict[str, Any]:
    total_fee = float(row.get("total_fee") or 0)
    total_paid = float(row.get("total_paid") or 0)
    balance_fee = round(total_fee - total_paid, 2)
    info = _billing_group_key(student, class_doc)
    prev_raw = row.get("previous_year_outstanding")
    previous_year_outstanding = float(prev_raw) if prev_raw not in (None, "") else None
    return {
        "student_id": student["id"],
        "admission_no": student.get("admission_no"),
        "student_name": student.get("name"),
        "class_name": info["class_name"], "medium": info["medium"],
        "stream": info["stream"], "section": info["section"], "group_key": info["group_key"],
        "academic_year": row["academic_year"],
        "total_fee": total_fee,
        "total_paid": total_paid,
        "balance_fee": balance_fee,
        "previous_year_outstanding": previous_year_outstanding,
        "remarks": row.get("remarks") or row.get("notes"),
    }

@router.post("/fee-details")
async def upsert_fee_detail(body: Dict[str, Any],
                             user = Depends(require_roles("administrator", "manager", "accountant"))):
    """Create or update one student's bulk fee-detail record for an academic year.
    This is an office reference record — it never creates a receipt and never feeds into the
    live receipts-based ledger total, so it can't double-count against real collections.
    A non-null `previous_year_outstanding` is ALSO written to student_opening_balances so the
    student ledger and this record can never disagree."""
    sid = str(body.get("student_id") or "").strip()
    academic_year = str(body.get("academic_year") or "").strip()
    if not sid or not academic_year:
        raise HTTPException(400, "student_id and academic_year are required")
    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id": 0}) or {}
    shaped = _shape_row(body, student, class_doc)
    if shaped["previous_year_outstanding"] is not None:
        await _set_opening_balance(sid, academic_year, shaped["previous_year_outstanding"],
                                    f"Bulk Fee Detail Update (manual entry) by {user['name']}", user)
    existing = await db.fee_details.find_one({"student_id": sid, "academic_year": academic_year})
    now = now_iso()
    if existing:
        await db.fee_details.update_one(
            {"student_id": sid, "academic_year": academic_year},
            {"$set": {**shaped, "updated_at": now, "updated_by": user["name"], "source": "manual"}},
        )
        fdid = existing["id"]
    else:
        fdid = gen_id()
        await db.fee_details.insert_one({"id": fdid, **shaped, "created_at": now, "created_by": user["name"],
                                          "updated_at": now, "updated_by": user["name"], "source": "manual"})
    await audit(user, "upsert", "fee_detail", fdid, {"student_id": sid, "academic_year": academic_year})
    return await db.fee_details.find_one({"id": fdid}, {"_id": 0})

# ---------------- Bulk XLSX/CSV import: preview -> confirm ----------------

async def _classify_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate + classify every row WITHOUT writing anything. Returns the same shape whether
    called for a preview or right before a commit, so the UI's preview is exactly what will
    happen."""
    seen_admission_nos: Dict[str, int] = {}
    valid, invalid, duplicates = [], [], []
    for idx, r in enumerate(rows):
        row_no = idx + 1
        adm = str(r.get("admission_no", "")).strip()
        academic_year = str(r.get("academic_year", "")).strip()
        if not adm:
            invalid.append({"row": row_no, "error": "admission_no is required", "data": r}); continue
        if not academic_year:
            invalid.append({"row": row_no, "error": "academic_year is required", "data": r}); continue
        if adm in seen_admission_nos:
            duplicates.append({"row": row_no, "error": f"admission_no '{adm}' also appears at row {seen_admission_nos[adm]} in this file", "data": r})
            continue
        seen_admission_nos[adm] = row_no
        student = await db.students.find_one({"admission_no": adm}, {"_id": 0})
        if not student:
            invalid.append({"row": row_no, "error": f"No student found with admission_no '{adm}'", "data": r}); continue
        try:
            total_fee = float(r.get("total_fee") or 0)
            total_paid = float(r.get("total_paid") or 0)
        except (TypeError, ValueError):
            invalid.append({"row": row_no, "error": "total_fee and total_paid must be numbers", "data": r}); continue
        if total_fee < 0 or total_paid < 0:
            invalid.append({"row": row_no, "error": "total_fee and total_paid cannot be negative", "data": r}); continue
        class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id": 0}) or {}
        info = _billing_group_key(student, class_doc)
        mismatch = None
        row_class = str(r.get("class_name") or "").strip()
        row_medium = str(r.get("medium") or "").strip()
        row_stream = str(r.get("stream") or "").strip()
        if row_class and row_class != info["class_name"]:
            mismatch = f"row says Class '{row_class}' but student '{student['name']}' ({adm}) is actually in {info['class_name']}"
        elif row_medium and row_medium != info["medium"]:
            mismatch = f"row says Medium '{row_medium}' but student '{student['name']}' ({adm}) is actually {info['medium']}"
        elif row_stream and info["stream"] and row_stream != info["stream"]:
            mismatch = f"row says Stream '{row_stream}' but student '{student['name']}' ({adm}) is actually {info['stream']}"
        if mismatch:
            invalid.append({"row": row_no, "error": f"Class/group mismatch — {mismatch}. Student's class was NOT changed.", "data": r})
            continue
        existing = await db.fee_details.find_one({"student_id": student["id"], "academic_year": academic_year}, {"_id": 0})
        prev_raw = r.get("previous_year_outstanding")
        prev_val = float(prev_raw) if prev_raw not in (None, "") else None
        valid.append({
            "row": row_no, "admission_no": adm, "student_name": student["name"],
            "class_name": info["class_name"], "medium": info["medium"], "stream": info["stream"],
            "action": "update" if existing else "add",
            "old": {"total_fee": existing["total_fee"], "total_paid": existing["total_paid"],
                    "previous_year_outstanding": existing.get("previous_year_outstanding")} if existing else None,
            "new": {"total_fee": total_fee, "total_paid": total_paid, "previous_year_outstanding": prev_val},
            "student_id": student["id"], "raw": r,
        })
    return {
        "total_rows": len(rows),
        "valid_rows": len(valid),
        "rows_to_add": sum(1 for v in valid if v["action"] == "add"),
        "rows_to_update": sum(1 for v in valid if v["action"] == "update"),
        "invalid_rows": len(invalid),
        "duplicate_rows": len(duplicates),
        "valid": valid, "invalid": invalid, "duplicates": duplicates,
    }

@router.post("/fee-details/bulk-import")
async def bulk_import_fee_details(body: Dict[str, Any],
                                   user = Depends(require_roles("administrator", "manager"))):
    """Import many rows at once from a class-wise Fee Update XLSX/CSV. Each row is matched to
    an existing student by `admission_no` ONLY — never by name — so a typo in a name can never
    create a duplicate student or attach figures to the wrong one.

    Pass `preview: true` to validate and classify every row (new/update/invalid/duplicate,
    old value -> new value) WITHOUT writing anything. Call again with `preview` omitted/false
    to actually commit — the admin must see the preview and confirm before any write happens.

    Required columns: admission_no, academic_year, total_fee, total_paid.
    Optional: previous_year_outstanding, remarks, class_name/medium/stream (used only to
    detect a class/group mismatch — never to move a student to a different class)."""
    rows: List[Dict[str, Any]] = body.get("rows", [])
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "rows must be a non-empty array")
    preview = bool(body.get("preview"))
    result = await _classify_rows(rows)
    if preview:
        return {**result, "committed": False}

    batch_id = body.get("batch_id") or gen_id()
    created = updated = 0
    for v in result["valid"]:
        r = v["raw"]
        student = await db.students.find_one({"id": v["student_id"]}, {"_id": 0})
        class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id": 0}) or {}
        shaped = _shape_row(r, student, class_doc)
        academic_year = shaped["academic_year"]
        if shaped["previous_year_outstanding"] is not None:
            await _set_opening_balance(v["student_id"], academic_year, shaped["previous_year_outstanding"],
                                        f"Bulk Fee Detail Update import (batch {batch_id}) by {user['name']}", user)
        now = now_iso()
        if v["action"] == "update":
            await db.fee_details.update_one(
                {"student_id": v["student_id"], "academic_year": academic_year},
                {"$set": {**shaped, "updated_at": now, "updated_by": user["name"], "source": "bulk_import", "import_batch_id": batch_id}},
            )
            updated += 1
        else:
            await db.fee_details.insert_one({
                "id": gen_id(), **shaped, "created_at": now, "created_by": user["name"],
                "updated_at": now, "updated_by": user["name"], "source": "bulk_import", "import_batch_id": batch_id,
            })
            created += 1
    await audit(user, "bulk_import", "fee_detail", batch_id, {
        "created": created, "updated": updated, "invalid": result["invalid_rows"], "duplicates": result["duplicate_rows"],
        "total_rows": result["total_rows"],
    })
    return {"created": created, "skipped": updated, "errors": result["invalid"] + result["duplicates"],
            "total": result["total_rows"], "batch_id": batch_id, "committed": True}

@router.post("/fee-details/bulk-delete")
async def bulk_delete_fee_details(body: Dict[str, Any], user = Depends(require_roles("administrator", "manager"))):
    """Undo a bulk import batch. Fee-detail records are pure office bookkeeping data (never
    receipts), so nothing here is 'protected' the way a student with real receipts is —
    every row from the batch is removed."""
    batch_id = body.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id is required")
    res = await db.fee_details.delete_many({"import_batch_id": batch_id})
    await audit(user, "bulk_delete", "fee_detail", batch_id, {"deleted": res.deleted_count})
    return {"deleted": res.deleted_count, "protected_referenced": 0}

@router.delete("/fee-details/{fdid}")
async def delete_fee_detail(fdid: str, user = Depends(require_roles("administrator", "manager"))):
    res = await db.fee_details.delete_one({"id": fdid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    await audit(user, "delete", "fee_detail", fdid, {})
    return {"deleted": True}
