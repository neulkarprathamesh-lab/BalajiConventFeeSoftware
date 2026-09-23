"""Receipt Types (DB-backed) + Receipts + Adjustments + Extensions + Reminders + cancel/reprint."""
import re
from typing import Any, Dict, List, Optional, Literal
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Depends, Response
from core import (
    db, ReceiptTypeIn, ReceiptIn, AdjustmentIn, ExtensionCreateIn, ExtensionApproveIn, ReminderFollowupIn,
    audit, gen_id, get_current_user, now_iso, require_roles,
    require_admin_pin, require_admin_dual, require_receipt_delete_pin, get_settings_doc,
    next_receipt_number, next_voucher_number, amount_in_words_inr,
    DEFAULT_RECEIPT_TYPES, _seed_receipt_types_if_empty,
    eligible_receipt_codes_for_class,
)

# Receipt-type codes that are intentionally broad/special and exempt from the
# class/medium/stream eligibility check below (they have their own separate
# rules, already enforced elsewhere): EMJC is broad-by-design (per its own
# applicable_dept_codes), BUS is governed by the bus_required check further
# down, DV is Finance/Petty Cash and not a student academic receipt.
_ELIGIBILITY_EXEMPT_CODES = {"EMJC", "BUS", "DV"}

router = APIRouter(prefix="/api", tags=["receipts"])

# ---------- Receipt Types ----------
@router.get("/receipt-types")
async def list_receipt_types(
    category: Optional[Literal["school","bus","finance","misc"]] = None,
    include_disabled: bool = False,
    include_archived: bool = False,
    user = Depends(get_current_user),
):
    await _seed_receipt_types_if_empty()
    q: Dict[str, Any] = {}
    if not include_archived: q["archived"] = {"$ne": True}
    if not include_disabled: q["enabled"] = True
    if category: q["category"] = category
    return await db.receipt_types.find(q, {"_id":0}).sort("display_order", 1).to_list(200)

@router.get("/receipt-types/format-default")
async def get_receipt_format_default(user = Depends(get_current_user)):
    """The school-wide receipt format template, if an Administrator has ever
    saved one via 'Apply to All Receipts'. The frontend uses this to prefill
    new receipt types with the current house style. Returns null if the
    school is still on the factory format.

    Registered BEFORE /receipt-types/{rtid} below - FastAPI/Starlette match
    routes in registration order, and a literal path like this one must come
    before a parameterized path with the same shape or the parameterized
    route swallows it (rtid="format-default", 404 Not Found)."""
    return await db.receipt_format_default.find_one({"id": "global"}, {"_id": 0})

@router.get("/receipt-types/{rtid}")
async def get_receipt_type(rtid: str, user = Depends(get_current_user)):
    doc = await db.receipt_types.find_one({"id": rtid}, {"_id":0})
    if not doc: raise HTTPException(404, "Not found")
    return doc

@router.post("/receipt-types")
async def create_receipt_type(body: ReceiptTypeIn, user = Depends(require_admin_pin)):
    if await db.receipt_types.find_one({"code": body.code.upper()}):
        raise HTTPException(400, f"Receipt type with prefix {body.code} already exists")
    rid = gen_id()
    doc = {"id": rid, **body.model_dump(), "code": body.code.upper(), "created_at": now_iso(), "updated_at": now_iso()}
    await db.receipt_types.insert_one(doc)
    await audit(user, "create", "receipt_type", rid, {"code": doc["code"], "name": doc["name"]})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.patch("/receipt-types/{rtid}")
async def update_receipt_type(rtid: str, body: Dict[str, Any], user = Depends(require_admin_pin)):
    existing = await db.receipt_types.find_one({"id": rtid})
    if not existing: raise HTTPException(404, "Not found")
    allowed = {"name","department_name","department_id","category","description","icon","display_order","enabled","tabs","default_payment_modes","print_template","report_category","notes","archived",
               "paper_size","orientation","theme","signature_layout","signatures_config","margins_mm","header_text","footer_text","watermark_text","watermark_enabled","barcode_enabled","qr_enabled","signature_area_enabled","computer_generated_note",
               "starting_number","current_number","auto_reset_yearly","fields"}
    upd = {k: v for k, v in body.items() if k in allowed}
    if "code" in body and body["code"]:
        new_code = str(body["code"]).upper()
        if new_code != existing.get("code"):
            if await db.receipt_types.find_one({"code": new_code, "id": {"$ne": rtid}}):
                raise HTTPException(400, f"Another receipt type already uses prefix {new_code}")
            upd["code"] = new_code
    if not upd:
        raise HTTPException(400, "Nothing to update")
    upd["updated_at"] = now_iso()
    await db.receipt_types.update_one({"id": rtid}, {"$set": upd})
    await audit(user, "update", "receipt_type", rtid, {"before": {k: existing.get(k) for k in upd.keys()}, "after": upd})
    doc = await db.receipt_types.find_one({"id": rtid}, {"_id":0})
    return doc

@router.delete("/receipt-types/{rtid}")
async def delete_receipt_type(rtid: str, user = Depends(require_admin_pin)):
    doc = await db.receipt_types.find_one({"id": rtid})
    if not doc: raise HTTPException(404, "Not found")
    used = await db.receipts.count_documents({"receipt_type_id": rtid})
    if used > 0:
        raise HTTPException(409, {"message": f"This receipt type has {used} existing transactions. Disable or archive it instead.", "used_count": used, "can_archive": True})
    await db.receipt_types.delete_one({"id": rtid})
    await audit(user, "delete", "receipt_type", rtid, {"code": doc.get("code"), "name": doc.get("name")})
    return {"deleted": True}

@router.post("/receipt-types/{rtid}/archive")
async def archive_receipt_type(rtid: str, user = Depends(require_admin_pin)):
    doc = await db.receipt_types.find_one({"id": rtid})
    if not doc: raise HTTPException(404, "Not found")
    await db.receipt_types.update_one({"id": rtid}, {"$set": {"archived": True, "enabled": False, "updated_at": now_iso()}})
    await audit(user, "archive", "receipt_type", rtid, {"code": doc.get("code")})
    return {"archived": True}

@router.post("/receipt-types/{rtid}/reset-sequence")
async def reset_receipt_type_sequence(rtid: str, body: Dict[str, Any], user = Depends(require_admin_dual)):
    """Manual Sequence Reset — DUAL-AUTH required (PIN + password)."""
    doc = await db.receipt_types.find_one({"id": rtid})
    if not doc: raise HTTPException(404, "Not found")
    try: new_number = int(body.get("new_number", 0))
    except Exception: raise HTTPException(400, "new_number must be an integer")
    reason = str(body.get("reason","")).strip()
    if new_number < 1: raise HTTPException(400, "new_number must be >= 1")
    if len(reason) < 5: raise HTTPException(400, "Reason must be at least 5 characters")
    prefix = doc["code"]
    academic_year = body.get("academic_year") or "2026-27"
    year4 = academic_year.split("-")[0]
    conflict = await db.receipts.find_one(
        {"number": {"$regex": f"^{prefix}-{year4}-\\d{{6}}$"}},
        sort=[("number", -1)]
    )
    highest_seq = 0
    if conflict:
        try: highest_seq = int(conflict["number"].rsplit("-", 1)[-1])
        except Exception: highest_seq = 0
    if new_number <= highest_seq:
        raise HTTPException(409, f"Would create duplicate numbers — highest existing receipt is #{highest_seq:06d}. new_number must be > {highest_seq}.")
    counter_key = f"RT-{prefix}-{academic_year}"
    prev = await db.counters.find_one({"key": counter_key}) or {"seq": 0}
    prev_seq = prev.get("seq", 0)
    await db.counters.update_one({"key": counter_key}, {"$set": {"seq": new_number - 1}}, upsert=True)
    await db.receipt_types.update_one({"id": rtid}, {"$set": {"current_number": new_number - 1, "updated_at": now_iso()}})
    await audit(user, "sequence_reset", "receipt_type", rtid, {
        "code": prefix, "academic_year": academic_year,
        "previous_seq": prev_seq, "new_next_number": new_number, "highest_existing": highest_seq,
        "reason": reason,
    })
    return {"ok": True, "prefix": prefix, "previous_seq": prev_seq, "next_will_be": f"{prefix}-{year4}-{new_number:06d}", "reason": reason}

@router.post("/receipt-types/reseed-defaults")
async def reseed_receipt_types(user = Depends(require_admin_pin)):
    """Idempotent — only adds any DEFAULT_RECEIPT_TYPES rows whose prefix is missing."""
    depts = {d["code"]: d for d in await db.departments.find({}, {"_id":0}).to_list(50)}
    now = now_iso(); added = []
    for t in DEFAULT_RECEIPT_TYPES:
        if await db.receipt_types.find_one({"code": t["code"]}):
            continue
        dept = depts.get(t["code"])
        await db.receipt_types.insert_one({
            "id": gen_id(), **t,
            "department_id": dept["id"] if dept else None,
            "enabled": True, "archived": False,
            "default_payment_modes": ["cash","upi","card"],
            "print_template": "a4-navy", "report_category": t["category"],
            "created_at": now, "updated_at": now,
        })
        added.append(t["code"])
    await audit(user, "reseed", "receipt_type", "", {"added": added})
    return {"added": added, "count": len(added)}

# ---------- Global receipt format (Administrator-only; applies to every receipt type) ----------
# Fields that make up a receipt's PRINTED FORMAT, as opposed to its identity
# (code/name/department/category) or numbering (starting_number/current_number).
# This is exactly the "Printing" + "Fields" tab content in the edit modal.
RECEIPT_FORMAT_FIELDS = [
    "paper_size", "orientation", "theme", "signature_layout", "signatures_config",
    "margins_mm", "header_text", "footer_text", "watermark_text", "watermark_enabled",
    "barcode_enabled", "qr_enabled", "signature_area_enabled", "computer_generated_note",
    "fields", "print_template",
]
RECEIPT_FORMAT_DEFAULTS: Dict[str, Any] = {
    "paper_size": "A5", "orientation": "portrait", "theme": "bw", "signature_layout": "row",
    "signatures_config": {"receiver": True, "accountant": True, "principal": True, "director": True},
    "margins_mm": {"top": 8, "right": 8, "bottom": 8, "left": 8},
    "header_text": None, "footer_text": None, "watermark_text": None, "watermark_enabled": False,
    "barcode_enabled": False, "qr_enabled": True, "signature_area_enabled": True,
    "computer_generated_note": "This is a computer-generated receipt.",
    "fields": {
        "admission_no": True, "roll_no": False, "parent_name": True, "mobile": True,
        "class": True, "division": False, "department": True, "academic_year": True,
        "session": False, "fee_head": True, "amount_in_words": True, "payment_mode": True,
        "transaction_id": True, "cashier_name": True, "authorized_by": False, "remarks": True,
    },
    "print_template": "a4-navy",
}

@router.post("/receipt-types/{rtid}/apply-format-to-all")
async def apply_receipt_format_to_all(rtid: str, user = Depends(require_admin_pin)):
    """Administrator-only (403 for every other role via require_admin_pin).
    Takes this receipt type's current PRINTING/FIELDS settings (paper size,
    margins, signatures, watermark, which fields print) and makes them the
    school-wide template: every other receipt type is updated to match, and
    the template is saved in `receipt_format_default` on the Main Server so
    every Client PC and every user who prints receipts picks it up on their
    next request - there is nothing to install or sync on the client side.

    This only ever writes to the `receipt_types` collection (and the global
    template doc) - it never touches `receipts`. Already-issued receipts
    keep their original amount, number, date and payment details untouched
    forever; a reprint renders with the CURRENT receipt-type format (exactly
    like every other format edit already does here), which is the intended
    "financial record is immutable, presentation can be refreshed" behavior.
    """
    src = await db.receipt_types.find_one({"id": rtid})
    if not src: raise HTTPException(404, "Not found")
    fmt = {k: src.get(k, RECEIPT_FORMAT_DEFAULTS.get(k)) for k in RECEIPT_FORMAT_FIELDS}
    now = now_iso()
    result = await db.receipt_types.update_many({}, {"$set": {**fmt, "updated_at": now}})
    await db.receipt_format_default.update_one(
        {"id": "global"},
        {"$set": {"id": "global", **fmt, "source_receipt_type_id": rtid, "source_code": src.get("code"),
                   "updated_at": now, "updated_by": user["email"]}},
        upsert=True,
    )
    await audit(user, "apply_format_to_all", "receipt_type", rtid,
                {"source_code": src.get("code"), "matched": result.matched_count, "modified": result.modified_count})
    return {"ok": True, "applied_to": result.matched_count, "source_code": src.get("code")}

@router.post("/receipt-types/format/reset-to-default")
async def reset_receipt_format_to_default(user = Depends(require_admin_pin)):
    """Administrator-only (403 for every other role). Restores the school's
    original factory receipt format on every receipt type and clears the
    saved global template. Never touches the `receipts` collection."""
    now = now_iso()
    result = await db.receipt_types.update_many({}, {"$set": {**RECEIPT_FORMAT_DEFAULTS, "updated_at": now}})
    await db.receipt_format_default.delete_one({"id": "global"})
    await audit(user, "reset_format_to_default", "receipt_type", "", {"matched": result.matched_count, "modified": result.modified_count})
    return {"ok": True, "reset_count": result.matched_count}

# ---------- Receipts ----------
@router.post("/receipts")
async def create_receipt(body: ReceiptIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    dept = await db.departments.find_one({"id": body.department_id})
    if not dept: raise HTTPException(400, "Invalid department")
    student = None
    if body.student_id:
        student = await db.students.find_one({"id": body.student_id})
        if not student: raise HTTPException(400, "Invalid student")
        # A receipt's department_id decides the numbering prefix and whose
        # money this is - it must match the student's own actual department.
        # This was previously unchecked: only the cosmetic receipt_type_id
        # template was validated (below), so a cashier could file a Class 5
        # student's payment under Junior College's department with no
        # rejection at all. Debit vouchers/general receipts with no
        # student_id are unaffected.
        student_dept_id = student.get("department_id")
        if student_dept_id and student_dept_id != body.department_id:
            student_dept = await db.departments.find_one({"id": student_dept_id}, {"_id": 0, "name": 1})
            raise HTTPException(
                400,
                f"{student['name']} belongs to {student_dept['name'] if student_dept else 'a different department'}, "
                f"not {dept['name']}. Select the correct department for this student."
            )
        # A student without active bus facility must never receive a BUS receipt.
        if body.receipt_type == "bus" and not student.get("bus_required"):
            raise HTTPException(400, f"{student['name']} does not currently have an active bus facility — a BUS receipt cannot be issued.")
    total = sum(l.amount for l in body.lines)

    # Independent backend guard (never trust the frontend alone): a BUS receipt
    # can only ever collect what is actually owed in the student's real
    # bus_charges records - this is what stops a school/tuition/admission fee
    # from ever being smuggled through under receipt_type="bus", regardless of
    # what lines the client sent. Never invents a charge - if bus_charges have
    # not been generated for this student yet, real bus dues are ₹0 and the
    # receipt is rejected rather than accepting an unverifiable amount.
    if body.receipt_type == "bus" and student:
        unpaid_charges = await db.bus_charges.find(
            {"student_id": body.student_id, "status": {"$in": ["unpaid", "partial"]}}, {"_id": 0},
        ).to_list(500)
        bus_due = sum(max(0.0, float(c.get("amount", 0)) - float(c.get("amount_paid", 0))) for c in unpaid_charges)
        if total - bus_due > 0.01:
            raise HTTPException(
                400,
                f"This BUS receipt (₹{total:,.2f}) exceeds {student['name']}'s actual pending bus fee "
                f"(₹{bus_due:,.2f}). A Bus Receipt can only collect real bus_charges dues, never school/"
                f"tuition/admission/other fees."
            )

    # ---- Business rules ---------------------------------------------------
    # Admission Fee is a one-time-only line per student per academic year.
    # School-fee payments are validated purely against the student's live
    # total outstanding (same ledger the receipt screen shows), never
    # against individual fee-head amounts: any amount up to and including
    # the full outstanding is a legitimate payment and is accepted with
    # auto-allocation across lines exactly as entered; only an amount that
    # would exceed the outstanding is rejected.
    if student:
        line_names = {(l.fee_head_name or "").strip().lower() for l in body.lines}
        ay_now = dept.get("academic_year", "2026-27")
        if "admission fee" in line_names:
            prior = await db.receipts.find(
                {"student_id": body.student_id, "status": {"$ne": "cancelled"},
                 "academic_year": ay_now, "lines.fee_head_name": {"$regex": "^admission fee$", "$options": "i"}},
                {"_id": 0, "number": 1}
            ).to_list(5)
            if prior:
                raise HTTPException(409, f"Admission Fee for {student['name']} was already collected on receipt {prior[0]['number']} — it cannot be charged again.")
        if body.receipt_type == "school":
            from routers import students as students_router
            current_ledger = await students_router.student_ledger(body.student_id, user)
            # A negative outstanding (e.g. a credit carried forward in
            # student_opening_balances) means nothing is currently owed -
            # clamp at 0 for this comparison only, same convention the
            # ledger itself already applies to school_payable, so a
            # credit-balance student is never told a legitimate payment
            # "exceeds" a negative number.
            current_outstanding = max(0.0, round(float(current_ledger.get("outstanding", 0)), 2))
            if round(total, 2) - current_outstanding > 0.01:
                raise HTTPException(
                    400,
                    f"Payment amount (₹{total:,.2f}) exceeds {student['name']}'s total outstanding "
                    f"balance (₹{current_outstanding:,.2f}). Please enter an amount up to the outstanding balance."
                )

    if body.receipt_type in ("refund","debit_voucher"):
        if user["role"] not in ("administrator","manager"):
            raise HTTPException(403, "Refund/voucher requires manager or admin")
    ay = dept.get("academic_year", "2026-27")

    # class_doc is needed by the receipt-type eligibility check below, and is
    # reused again further down when building the student snapshot - fetched
    # once, here, before any receipt number is generated.
    class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id": 0}) if student and student.get("class_id") else None

    # Explicit receipt-TEMPLATE selection (EP/MP/SEC/JC/JC-ACS/EMP/EMJC/BUS/V) is
    # independent of receipt_type (business rules) and department_id (whose money
    # this is), but it must still make sense for that student - never let an
    # English Primary student's payment go out under a "Junior College" template.
    #
    # Deliberately validated BEFORE any receipt number is generated below: a
    # receipt number is consumed from an atomic, never-reused counter, so if
    # this check raised AFTER the number had already been drawn, every
    # rejected receipt-type/eligibility mismatch would permanently burn a
    # number that no receipt would ever use - a silent, avoidable gap in the
    # sequence on every validation failure, not just on an actually-completed
    # then later cancelled/deleted receipt.
    chosen_rt = None
    if body.receipt_type_id:
        chosen_rt = await db.receipt_types.find_one({"id": body.receipt_type_id}, {"_id": 0})
        if not chosen_rt:
            raise HTTPException(400, "Selected receipt type not found")
        allowed_codes = chosen_rt.get("applicable_dept_codes")
        if allowed_codes and dept["code"] not in allowed_codes:
            raise HTTPException(
                400,
                f"Receipt type '{chosen_rt.get('name')}' cannot be used for a {dept['name']} student "
                f"(applies to: {', '.join(allowed_codes)}). Choose a matching receipt type."
            )
        # Class/medium/stream eligibility (per the authoritative receipt-type
        # mapping) — the check above only validated the department; this is
        # the finer rule that previously did not exist at all (e.g. it would
        # not have caught a Class 5 student being issued an "EP" receipt,
        # since EP and EMP share the same department). Only applies to
        # student-attached receipts of a non-exempt code; EMJC/BUS/DV have
        # their own separate rules (see _ELIGIBILITY_EXEMPT_CODES above).
        chosen_code = chosen_rt.get("code")
        if student and chosen_code and chosen_code not in _ELIGIBILITY_EXEMPT_CODES:
            eligible_codes, _notes = eligible_receipt_codes_for_class(
                class_doc.get("name") if class_doc else None,
                student.get("medium"),
                student.get("stream"),
            )
            if eligible_codes and chosen_code not in eligible_codes:
                raise HTTPException(
                    400,
                    f"{student['name']}'s class/medium ({(class_doc.get('name') if class_doc else 'unknown')} · "
                    f"{student.get('medium') or 'unknown medium'}) does not match receipt type '{chosen_rt.get('name')}' "
                    f"({chosen_code}). Eligible type(s) for this student: {', '.join(eligible_codes)}."
                )

    if body.receipt_type == "debit_voucher":
        number = await next_voucher_number(ay)
    else:
        number = await next_receipt_number(dept["code"], ay)
    rid = gen_id()
    # Rich student snapshot so receipts always self-describe (survives student edits)
    snapshot = None
    if student:
        fs_doc = await db.fee_structures.find_one({"id": student.get("fee_structure_id")}, {"_id":0, "items":0}) if student.get("fee_structure_id") else None
        bus_route_doc = await db.bus_routes.find_one({"code": student.get("bus_route")}, {"_id":0}) if student.get("bus_route") else None
        snapshot = {
            "admission_no": student["admission_no"], "name": student["name"],
            "father_name": student.get("father_name"), "mother_name": student.get("mother_name"),
            "guardian_mobile": student.get("guardian_mobile"),
            "class_id": student.get("class_id"),
            "class_name": class_doc.get("name") if class_doc else None,
            "section": student.get("section"), "roll_no": student.get("roll_no"),
            "medium": student.get("medium"), "stream": student.get("stream"),
            "bus_stop_no": student.get("bus_stop_no"),
            "bus_stop_name": student.get("bus_stop_name"),
            "bus_main_area": student.get("bus_main_area"),
            # "Bus No." (vehicle_no) — captured from the student's linked bus_route,
            # if one exists, at the moment this receipt is created. Currently no
            # student has a bus_route assigned (0 routes exist system-wide), so this
            # will be None on every current receipt — that's correct, not a bug: it
            # means the field is real but genuinely unpopulated, never invented.
            "bus_vehicle_no": bus_route_doc.get("vehicle_no") if bus_route_doc else None,
            "academic_year": student.get("academic_year") or ay,
            "fee_structure_name": (f"{fs_doc.get('medium')} · {fs_doc.get('class_name')}"
                                    + (f" · {fs_doc.get('stream')}" if fs_doc and fs_doc.get('stream') else "")) if fs_doc else None,
        }

    doc = {
        "id": rid, "number": number, "receipt_type": body.receipt_type,
        "receipt_type_id": body.receipt_type_id,
        "department_id": body.department_id, "department_name": dept["name"], "department_code": dept["code"],
        "department_header1": dept.get("header_line1"), "department_header2": dept.get("header_line2"),
        "student_id": body.student_id,
        "student_snapshot": snapshot,
        "payer_name": body.payer_name or (student["name"] if student else None),
        "purpose": body.purpose, "payment_mode": body.payment_mode, "payment_reference": body.payment_reference,
        "lines": [l.model_dump() for l in body.lines], "total": total,
        "amount_in_words": amount_in_words_inr(total),
        "remarks": body.remarks, "linked_receipt_id": body.linked_receipt_id,
        "metadata": body.metadata or {},
        "academic_year": ay, "cashier_id": user["id"], "cashier_name": user["name"],
        "status": "issued", "reprint_count": 0,
        "created_at": now_iso(),
    }
    await db.receipts.insert_one(doc)
    await audit(user, "create", "receipt", rid, {"number": number, "total": total, "type": body.receipt_type})

    # Apply this payment against the student's oldest unpaid bus charges first
    # (FIFO by month) - this is how a normal payment "collects" bus outstanding.
    # Charges are DUES tracked in bus_charges; this never creates a second
    # receipt, it only marks existing charge rows paid/partial.
    if body.receipt_type == "bus" and body.student_id:
        remaining = total
        unpaid = await db.bus_charges.find(
            {"student_id": body.student_id, "status": {"$in": ["unpaid", "partial"]}},
            {"_id": 0},
        ).sort("month", 1).to_list(500)
        for ch in unpaid:
            if remaining <= 0.004:
                break
            due = float(ch["amount"]) - float(ch.get("amount_paid", 0))
            if due <= 0:
                continue
            pay = min(due, remaining)
            new_paid = float(ch.get("amount_paid", 0)) + pay
            new_status = "paid" if new_paid >= float(ch["amount"]) - 0.01 else "partial"
            await db.bus_charges.update_one({"id": ch["id"]}, {"$set": {
                "amount_paid": new_paid, "status": new_status, "last_payment_receipt_id": rid,
            }})
            remaining -= pay

    if body.student_id:
        # Balance Remaining — a frozen historical snapshot, computed from the REAL
        # ledger (Total Fee - Total Paid - Approved Adjustments) at the instant this
        # receipt is created, AFTER it (and any bus FIFO settlement above) has been
        # applied. Never recomputed later: a receipt is an immutable financial
        # record, so an old receipt must always show the balance as it stood right
        # after THAT payment, not whatever the student's balance happens to be today.
        from routers import students as students_router
        ledger = await students_router.student_ledger(body.student_id, user)
        balance_after = ledger.get("outstanding", 0)

        # Per-fee-head Total/Paid/Balance breakdown for the fee table, also frozen at
        # creation time. Total Amount comes from the student's real fee structure;
        # Paid Amount is the cumulative real payment for that exact fee head across
        # every non-cancelled receipt this academic year, INCLUDING this one (the
        # query below runs after insert_one, so it already sees this receipt).
        # A head with no matching fee-structure line (e.g. an ad-hoc/misc charge)
        # gets total_amount=None rather than a fabricated figure.
        fs = await db.fee_structures.find_one({"id": student.get("fee_structure_id")}, {"_id": 0}) if student.get("fee_structure_id") else None
        fs_by_head = {}
        if fs:
            for item in fs.get("items", []):
                key = (item.get("fee_head_name") or "").strip().lower()
                fs_by_head[key] = fs_by_head.get(key, 0.0) + float(item.get("amount", 0))
        prior_receipts = await db.receipts.find(
            {"student_id": body.student_id, "status": {"$ne": "cancelled"}, "academic_year": ay},
            {"_id": 0, "lines": 1},
        ).to_list(1000)
        paid_by_head: Dict[str, float] = {}
        for pr in prior_receipts:
            for l in pr.get("lines", []):
                key = (l.get("fee_head_name") or "").strip().lower()
                paid_by_head[key] = paid_by_head.get(key, 0.0) + float(l.get("amount", 0))
        augmented_lines = []
        for l in doc["lines"]:
            key = (l.get("fee_head_name") or "").strip().lower()
            head_total = fs_by_head.get(key)
            head_paid = paid_by_head.get(key, 0.0)
            augmented_lines.append({
                **l,
                "total_amount": head_total,
                "paid_amount": head_paid,
                "balance_amount": max(0.0, head_total - head_paid) if head_total is not None else None,
            })

        await db.receipts.update_one({"id": rid}, {"$set": {"balance_after": balance_after, "lines": augmented_lines}})
        doc["balance_after"] = balance_after
        doc["lines"] = augmented_lines

    return {k:v for k,v in doc.items() if k != "_id"}

@router.get("/receipts")
async def list_receipts(
    q: Optional[str] = None, department_id: Optional[str] = None,
    receipt_type: Optional[str] = None, student_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    cashier_id: Optional[str] = None, limit: int = 200,
    user = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if department_id: query["department_id"] = department_id
    if receipt_type: query["receipt_type"] = receipt_type
    if student_id: query["student_id"] = student_id
    if cashier_id: query["cashier_id"] = cashier_id
    if q: query["number"] = {"$regex": re.escape(q), "$options": "i"}  # literal text, see students.py's list_students() fix
    if date_from or date_to:
        rng = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to + "T23:59:59"
        query["created_at"] = rng
    return await db.receipts.find(query, {"_id":0}).sort("created_at", -1).limit(limit).to_list(limit)

@router.get("/receipts/{rid}")
async def get_receipt(rid: str, user = Depends(get_current_user)):
    r = await db.receipts.find_one({"id": rid}, {"_id":0})
    if not r: raise HTTPException(404, "Not found")
    return r

@router.post("/receipts/{rid}/reprint")
async def reprint_receipt(rid: str, user = Depends(require_roles("administrator","cashier"))):
    r = await db.receipts.find_one({"id": rid})
    if not r: raise HTTPException(404, "Not found")
    await db.receipts.update_one({"id": rid}, {"$inc": {"reprint_count": 1}, "$set":{"last_reprint_at": now_iso(), "last_reprint_by": user["name"]}})
    await audit(user, "reprint", "receipt", rid, {"number": r["number"]})
    return {"ok": True}

@router.post("/receipts/{rid}/cancel")
async def cancel_receipt(rid: str, body: Dict[str, str], user = Depends(require_roles("administrator","manager"))):
    reason = body.get("reason","").strip()
    if not reason: raise HTTPException(400, "Reason required")
    r = await db.receipts.find_one({"id": rid})
    if not r: raise HTTPException(404, "Not found")
    await db.receipts.update_one({"id": rid}, {"$set":{"status":"cancelled","cancel_reason": reason,"cancelled_at": now_iso(),"cancelled_by": user["name"]}})
    await audit(user, "cancel", "receipt", rid, {"reason": reason})
    return {"ok": True}

@router.delete("/receipts/{rid}")
async def delete_receipt(rid: str, user = Depends(require_receipt_delete_pin)):
    """Permanent, irreversible receipt deletion - completely separate from cancel/void
    above, which keeps the record. Gated by require_receipt_delete_pin: role check
    (administrator/manager) AND the fixed deletion PIN, verified server-side, BEFORE
    this function body ever runs - by the time we get here, both have already passed.
    The receipt's `number` is never released for reuse: this only removes the
    document from `db.receipts`, and never touches `db.counters` in any way, so the
    numbering sequence stays permanently consumed at whatever it already reached."""
    r = await db.receipts.find_one({"id": rid})
    if not r:
        await audit(user, "receipt_delete_failed", "receipt", rid, {"reason": "receipt_not_found"})
        raise HTTPException(404, "Receipt not found")
    await db.receipts.delete_one({"id": rid})
    await audit(user, "receipt_deleted", "receipt", rid, {
        "number": r.get("number"), "total": r.get("total"), "student_id": r.get("student_id"),
        "receipt_type": r.get("receipt_type"),
    })
    return {"ok": True, "deleted_number": r.get("number")}

# ---------- Adjustments ----------
@router.post("/adjustments")
async def create_adjustment(body: AdjustmentIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    # A Fee Adjustment must always be attached to a real, currently-selected student -
    # never a mistyped/pasted id that silently creates an orphaned record nobody's
    # ledger ever picks up.
    student = await db.students.find_one({"id": body.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found - please select a valid student")
    aid = gen_id()
    doc = {"id": aid, **body.model_dump(), "status":"pending", "requested_by": user["id"], "requested_by_name": user["name"], "created_at": now_iso()}
    await db.adjustments.insert_one(doc)
    await audit(user, "create", "adjustment", aid, {"amount": body.amount, "type": body.adjustment_type, "student": student.get("name"), "admission_no": student.get("admission_no")})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.get("/adjustments")
async def list_adjustments(status: Optional[str] = None, user = Depends(get_current_user)):
    q = {"status": status} if status else {}
    return await db.adjustments.find(q, {"_id":0}).sort("created_at", -1).to_list(500)

@router.post("/adjustments/{aid}/approve")
async def approve_adjustment(aid: str, user = Depends(require_roles("administrator","manager"))):
    adj = await db.adjustments.find_one({"id": aid})
    if not adj: raise HTTPException(404, "Not found")
    settings = await get_settings_doc()
    cap = float(settings.get("manager_waiver_cap", 5000) or 5000)
    if user["role"] == "manager" and float(adj.get("amount", 0)) > cap:
        raise HTTPException(403, f"Adjustments over ₹{int(cap):,} require administrator approval")
    await db.adjustments.update_one({"id": aid}, {"$set":{"status":"approved","approved_by": user["id"],"approved_by_name": user["name"],"approved_at": now_iso()}})
    await audit(user, "approve", "adjustment", aid, {"amount": adj.get("amount")})
    return {"ok": True}

@router.post("/adjustments/{aid}/reject")
async def reject_adjustment(aid: str, body: Dict[str,str], user = Depends(require_roles("administrator","manager"))):
    await db.adjustments.update_one({"id": aid}, {"$set":{"status":"rejected","reject_reason": body.get("reason",""),"approved_by_name": user["name"],"approved_at": now_iso()}})
    await audit(user, "reject", "adjustment", aid)
    return {"ok": True}

@router.get("/adjustments/{aid}/letter")
async def adjustment_letter_pdf(aid: str, user = Depends(get_current_user)):
    """Concession / Fee Adjustment Letter for a Concession Ledger record. No separate
    'Concession Letter' template exists elsewhere in the app - this reuses the exact
    visual style (header, fonts, table structure, signature block) of the only other
    finalized fee-adjustment PDF in the codebase, /fee-adjustments/{id}/pdf, so every
    printed Fee Adjustment document in FeeHub looks the same. Works for a record from
    either the legacy Adjustments screen or a completed Fee Adjustment Application -
    both are the same `adjustments` collection the Concession Ledger reads."""
    import io, html as _html
    from xhtml2pdf import pisa
    from routers.fee_adjustments import _student_snapshot

    adj = await db.adjustments.find_one({"id": aid}, {"_id": 0})
    if not adj:
        raise HTTPException(404, "Not found")
    if adj.get("status") != "approved":
        raise HTTPException(409, "Only an approved adjustment can be printed as a letter")
    snap = await _student_snapshot(adj["student_id"])
    settings = await get_settings_doc()

    def inr(n):
        try: return "Rs. {:,.2f}".format(float(n))
        except Exception: return "-"

    school_name = (settings.get("school_name") or "Balaji Convent").upper()
    school_address = settings.get("school_address") or ""
    school_contact = " &middot; ".join(x for x in [
        f"Mob: {settings['school_phone']}" if settings.get("school_phone") else "",
        f"Email: {settings['school_email']}" if settings.get("school_email") else "",
    ] if x)

    adj_type_label = (adj.get("adjustment_type") or "-").replace("_", " ").title()
    approved_line = (f"Approved by {_html.escape(adj['approved_by_name'])} on {adj['approved_at'][:10]}"
                      if adj.get("approved_by_name") and adj.get("approved_at") else "-")

    html_str = f"""<html><head><style>
      @page {{ size: A4; margin: 14mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #111; }}
      h1 {{ font-size: 16px; text-align:center; margin: 0; }}
      .sub {{ text-align:center; font-size: 10px; color:#444; margin: 1px 0; }}
      .app-no {{ text-align:center; font-weight:bold; font-size: 12px; border: 1.5px solid #111; display:inline-block; padding: 3px 14px; margin: 6px 0 10px; }}
      table.details {{ width:100%; border-collapse: collapse; margin-bottom: 10px; }}
      table.details td {{ padding: 3px 4px; font-size: 10.5px; }}
      table.details td.label {{ color:#555; width: 130px; }}
      .section-title {{ font-weight:bold; font-size:11px; text-transform:uppercase; border-bottom:1.5px solid #111; padding-bottom:2px; margin: 10px 0 6px; }}
      table.fee {{ width:100%; border-collapse: collapse; margin-bottom: 8px; }}
      table.fee td, table.fee th {{ border: 1px solid #999; padding: 4px 6px; font-size: 10.5px; }}
      table.fee th {{ background:#f0f0f0; text-align:left; }}
      td.r {{ text-align:right; }}
      td.b {{ font-weight: bold; }}
      .reason-box {{ border: 1px solid #999; padding: 6px; min-height: 40px; font-size: 10.5px; }}
      table.sig {{ width:100%; border-collapse: collapse; margin-top: 40px; }}
      table.sig td {{ width:33.33%; text-align:center; border-top: 1px solid #333; padding-top: 5px; font-weight: bold; font-size: 10.5px; }}
    </style></head><body>
    <h1>{_html.escape(school_name)}</h1>
    <div class="sub">{_html.escape(school_address)}</div>
    {f'<div class="sub">{school_contact}</div>' if school_contact else ''}
    <div style="text-align:center;"><span class="app-no">CONCESSION / FEE ADJUSTMENT LETTER</span></div>

    <table class="details">
      <tr><td class="label">Student Name</td><td class="b">{_html.escape(snap['student_name'] or '')}</td>
          <td class="label">Admission No.</td><td class="b">{_html.escape(snap['admission_no'] or '')}</td></tr>
      <tr><td class="label">Class</td><td>{_html.escape(snap['class_name'] or '')}{(' / ' + snap['section']) if snap.get('section') else ''}</td>
          <td class="label">Medium</td><td>{_html.escape(snap['medium'] or '')}{(' - ' + snap['stream']) if snap.get('stream') else ''}</td></tr>
      <tr><td class="label">Academic Year</td><td>{_html.escape(snap['academic_year'] or '')}</td>
          <td class="label">Date</td><td>{(adj.get('created_at') or '')[:10]}</td></tr>
    </table>

    <div class="section-title">Fee Details</div>
    <table class="fee">
      <tr><th>Total Fee</th><th>Fee Paid Till Now</th><th>Concession / Adjustment Amount</th><th>Type</th></tr>
      <tr><td class="r">{inr(snap['total_fee'])}</td><td class="r">{inr(snap['total_paid'])}</td><td class="r b">{inr(adj.get('amount', 0))}</td><td>{_html.escape(adj_type_label)}</td></tr>
    </table>

    <div class="section-title">Reason for Adjustment</div>
    <div class="reason-box">{_html.escape(adj.get('reason','') or '')}</div>

    <div style="font-size:10px; color:#555; margin-top:8px;">{approved_line}</div>

    <table class="sig">
      <tr>
        <td>ACCOUNTANT</td>
        <td>MANAGER</td>
        <td>PRINCIPAL / ADMINISTRATOR</td>
      </tr>
    </table>
    </body></html>"""

    buf = io.BytesIO()
    pisa.CreatePDF(html_str, dest=buf)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="Concession_Letter_{snap.get("admission_no") or aid}.pdf"'})

# ---------- Extensions (Payment Extension Application - two-stage real-world workflow) ----------
# Stage 1 (Cashier): search student -> live snapshot -> reason -> PRINT. Creates the
# application as PENDING_APPROVAL and prints it with BLANK installment boxes - printing
# is never approval. Stage 2 (Cashier, once the physically-signed paper returns): open
# the application, transcribe the signed installment plan, confirm "signed approval
# received", which validates the plan against the CURRENT outstanding fee, marks the
# application APPROVED, and creates one reminder per approved installment (never a
# receipt, never a fee/balance change - see create_receipt for the actual payment path).
@router.post("/extensions")
async def create_extension(body: ExtensionCreateIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    student = await db.students.find_one({"id": body.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found - please select a valid student")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required for every Payment Extension application")
    from routers.fee_adjustments import _student_snapshot
    snap = await _student_snapshot(body.student_id)
    eid = gen_id()
    doc = {
        "id": eid, "student_id": body.student_id, "snapshot": snap, "reason": reason,
        "outstanding_amount": snap["current_balance"],
        "status": "pending_approval", "approved_installments": None,
        "requested_by": user["id"], "requested_by_name": user["name"], "created_at": now_iso(),
        "printed_count": 0, "last_printed_at": None,
        "approved_by": None, "approved_by_name": None, "approved_at": None,
    }
    await db.extensions.insert_one(doc)
    await audit(user, "create", "extension_application", eid, {"student": student.get("name"), "admission_no": student.get("admission_no"), "reason": reason})
    return {k: v for k, v in doc.items() if k != "_id"}

@router.get("/extensions")
async def list_extensions(status: Optional[str] = None, student_id: Optional[str] = None, user = Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if status: q["status"] = status
    if student_id: q["student_id"] = student_id
    rows = await db.extensions.find(q, {"_id":0}).sort("created_at", -1).to_list(500)
    eids = [r["id"] for r in rows]
    # "Next Installment" - the earliest still-pending reminder for this application, if any.
    pending_reminders = await db.reminders.find(
        {"extension_id": {"$in": eids}, "status": "pending"}, {"_id": 0}
    ).sort("due_date", 1).to_list(2000) if eids else []
    next_by_ext: Dict[str, dict] = {}
    for rem in pending_reminders:
        next_by_ext.setdefault(rem["extension_id"], rem)
    # Fallback for any pre-existing/legacy row created before the snapshot field existed.
    sids = list({r["student_id"] for r in rows if r.get("student_id") and not r.get("snapshot")})
    students = {s["id"]: s for s in await db.students.find({"id": {"$in": sids}}, {"_id": 0, "name": 1, "admission_no": 1}).to_list(len(sids) or 1)} if sids else {}
    for r in rows:
        snap = r.get("snapshot") or {}
        legacy = students.get(r.get("student_id"), {})
        r["student_name"] = snap.get("student_name") or legacy.get("name")
        r["admission_no"] = snap.get("admission_no") or legacy.get("admission_no")
        r["class_name"] = snap.get("class_name")
        r["section"] = snap.get("section")
        nxt = next_by_ext.get(r["id"])
        r["next_installment"] = {"amount": nxt["amount"], "due_date": nxt["due_date"]} if nxt else None
    return rows

@router.get("/extensions/{eid}")
async def get_extension(eid: str, user = Depends(get_current_user)):
    ext = await db.extensions.find_one({"id": eid}, {"_id": 0})
    if not ext:
        raise HTTPException(404, "Not found")
    reminders = await db.reminders.find({"extension_id": eid}, {"_id": 0}).sort("installment_index", 1).to_list(10)
    ext["reminders"] = reminders
    return ext

@router.post("/extensions/{eid}/approve-installments")
async def approve_extension_installments(eid: str, body: ExtensionApproveIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    """Stage 2: the cashier transcribes the SIGNED PHYSICAL PAPER's installment plan
    here. There is no digital Secretary sign-off - the physical signature IS the
    approval; `confirmed` just mirrors the on-screen "Signed approval received from
    school authority?" confirmation the cashier must explicitly click through."""
    ext = await db.extensions.find_one({"id": eid})
    if not ext:
        raise HTTPException(404, "Not found")
    if ext["status"] != "pending_approval":
        raise HTTPException(409, f"Application is '{ext['status']}' - only a Pending Approval application can be approved")
    if not body.confirmed:
        raise HTTPException(400, "Signed approval from the school authority must be confirmed before approving")
    insts = body.installments
    if not insts:
        raise HTTPException(400, "At least 1 installment is required")
    if len(insts) > 4:
        raise HTTPException(400, "A maximum of 4 installments is allowed")
    for idx, inst in enumerate(insts):
        if inst.amount is None or inst.amount <= 0:
            raise HTTPException(400, f"Installment {idx+1}: amount must be a positive number")
        if not (inst.due_date or "").strip():
            raise HTTPException(400, f"Installment {idx+1}: a proposed date is required")

    from routers.fee_adjustments import _student_snapshot
    snap = await _student_snapshot(ext["student_id"])
    current_outstanding = round(float(snap["current_balance"]), 2)
    total = round(sum(float(i.amount) for i in insts), 2)
    if abs(total - current_outstanding) > 0.01:
        raise HTTPException(
            400,
            f"Approved installment total (Rs. {total:,.2f}) must equal the student's current "
            f"outstanding fee (Rs. {current_outstanding:,.2f})."
        )

    approved_installments = [{"installment_no": idx + 1, "amount": float(i.amount), "due_date": i.due_date.strip()} for idx, i in enumerate(insts)]
    await db.extensions.update_one({"id": eid}, {"$set": {
        "approved_installments": approved_installments, "status": "approved",
        "outstanding_at_approval": current_outstanding,
        "approved_by": user["id"], "approved_by_name": user["name"], "approved_at": now_iso(),
    }})
    # Three distinct audit events for one cashier action, per the real-world sequence:
    # the physical authority approval, the data entry of that approval, and the
    # resulting status change - kept separate so the audit trail reads accurately.
    await audit(user, "authority_approval_received", "extension_application", eid, {
        "student": ext["snapshot"]["student_name"], "admission_no": ext["snapshot"]["admission_no"],
    })
    await audit(user, "approved_installment_plan_entered", "extension_application", eid, {
        "installments": approved_installments, "total": total,
    })
    await audit(user, "approve", "extension_application", eid, {"status": "approved"})

    # One reminder per approved installment - guarded against duplicates so opening
    # this application again (or a retry) never creates a second set.
    for inst in approved_installments:
        exists = await db.reminders.find_one({"extension_id": eid, "installment_index": inst["installment_no"] - 1})
        if exists:
            continue
        await db.reminders.insert_one({
            "id": gen_id(), "extension_id": eid, "student_id": ext["student_id"],
            "installment_index": inst["installment_no"] - 1, "installment_name": f"Installment {inst['installment_no']}",
            "amount": inst["amount"], "due_date": inst["due_date"],
            "reminder_text": "Call parent regarding payment extension installment.",
            "status": "pending", "created_at": now_iso(),
        })
    return await db.extensions.find_one({"id": eid}, {"_id": 0})

@router.post("/extensions/{eid}/reject")
async def reject_extension(eid: str, body: Dict[str,str], user = Depends(require_roles("administrator","manager"))):
    ext = await db.extensions.find_one({"id": eid})
    if not ext:
        raise HTTPException(404, "Not found")
    if ext["status"] != "pending_approval":
        raise HTTPException(409, f"Application is '{ext['status']}' - only a Pending Approval application can be cancelled")
    await db.extensions.update_one({"id": eid}, {"$set":{"status":"cancelled","reject_reason": body.get("reason",""),"approved_by_name": user["name"],"approved_at": now_iso()}})
    await audit(user, "reject", "extension_application", eid, {"reason": body.get("reason","")})
    return {"ok": True}

@router.get("/extensions/{eid}/pdf")
async def extension_pdf(eid: str, user = Depends(get_current_user)):
    """Payment Extension Application - approved design reference: school header
    (name/address/Mob/Email/tagline), A. Student Details, B. Fee Details (as per
    current records - live snapshot, never invented), C. Proposed Installment
    Plan (4 installments - BLANK until the application is Approved, matching the
    printed paper's hand-written boxes), D. Reason for Payment Extension, Secretary
    signature. Same physical page as the Daily Fee & Expense Report: 142.8mm x 210mm
    portrait (the receipt's own 210x142.8mm landscape paper, unchanged, rotated).
    Every fetch of this endpoint is itself the real-world "print" action, so it is
    audited as APPLICATION PRINTED here - never on creation, never implying approval."""
    import io, html as _html
    from xhtml2pdf import pisa
    from routers.fee_adjustments import _student_snapshot

    ext = await db.extensions.find_one({"id": eid}, {"_id": 0})
    if not ext:
        raise HTTPException(404, "Not found")
    snap = await _student_snapshot(ext["student_id"])
    settings = await get_settings_doc()

    await db.extensions.update_one({"id": eid}, {"$inc": {"printed_count": 1}, "$set": {"last_printed_at": now_iso()}})
    await audit(user, "print", "extension_application", eid, {"student": snap.get("student_name"), "admission_no": snap.get("admission_no")})

    def inr(n):
        try: return "Rs. {:,.2f}".format(float(n))
        except Exception: return "Rs. 0.00"

    school_name = (settings.get("school_name") or "Balaji Convent").upper()
    school_address = settings.get("school_address") or ""
    school_contact = " &middot; ".join(x for x in [
        f"Mob: {settings['school_phone']}" if settings.get("school_phone") else "",
        f"Email: {settings['school_email']}" if settings.get("school_email") else "",
    ] if x)

    # BLANK boxes for hand-writing until the signed paper has actually come back and
    # been transcribed via /approve-installments - never invented/pre-filled figures.
    approved = ext.get("approved_installments") or []
    inst_cells = ""
    for i in range(4):
        inst = approved[i] if i < len(approved) else None
        amt = inr(inst["amount"]) if inst else "&nbsp;"
        due = _html.escape(inst.get("due_date") or "") if inst else ""
        inst_cells += f"""<td class="inst">
            <div class="inst-h">Installment {i+1}</div>
            <div class="inst-l">Amount (Rs.)</div><div class="inst-v">{amt}</div>
            <div class="inst-l">Proposed Date</div><div class="inst-v">{due or '&nbsp;'}</div>
        </td>"""

    html_str = f"""<html><head><style>
      @page {{ size: 142.8mm 210mm; margin: 6mm 5mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 7.6px; }}
      .hd {{ text-align:center; border-bottom: 1.5px solid #1e3a5f; padding-bottom: 5px; margin-bottom: 6px; }}
      .hd h1 {{ font-size: 13px; margin: 0 0 2px; color:#1e3a5f; }}
      .hd .sub {{ font-size: 6.8px; color:#333; margin: 1px 0; }}
      .hd .tag {{ font-size: 6.6px; color:#c0662a; font-style: italic; margin-top: 3px; }}
      .title-bar {{ background:#fbe4cc; text-align:center; padding: 5px 2px; margin-bottom: 6px; }}
      .title-bar .t1 {{ font-size: 10px; font-weight: bold; color:#1e3a5f; letter-spacing: 0.4px; }}
      .title-bar .t2 {{ font-size: 6.8px; font-weight: bold; color:#444; margin-top: 1px; }}
      .date-line {{ text-align:right; font-size: 7.2px; margin-bottom: 6px; }}
      .section {{ background:#1e3a5f; color:#fff; font-weight:bold; font-size: 7.6px; padding: 3px 5px; text-transform: uppercase; }}
      table.kv {{ width:100%; border-collapse: collapse; margin-bottom: 6px; }}
      table.kv td {{ border: 1px solid #b9c4d0; padding: 2.5px 5px; font-size: 7.4px; }}
      table.kv td.label {{ width: 34%; background:#f3f6fa; }}
      table.kv td.sep {{ width: 4%; text-align:center; }}
      table.fee td.amt {{ font-weight:bold; }}
      table.inst {{ width:100%; border-collapse: collapse; margin-bottom: 6px; table-layout: fixed; }}
      table.inst td.inst {{ border: 1px solid #b9c4d0; padding: 4px 3px; vertical-align: top; width:25%; }}
      .inst-h {{ background:#fbe4cc; font-weight:bold; text-align:center; font-size: 6.8px; padding: 2px 0; margin: -4px -3px 3px; }}
      .inst-l {{ font-size: 6px; color:#666; margin-top: 3px; }}
      .inst-v {{ border: 1px solid #ccc; min-height: 12px; font-size: 6.8px; padding: 2px 3px; }}
      .reason-box {{ border: 1px solid #b9c4d0; min-height: 34px; padding: 5px; font-size: 7.4px; margin-bottom: 8px; }}
      .closing {{ font-size: 7px; margin-bottom: 20px; }}
      table.sig {{ width:100%; }}
      table.sig td {{ width:50%; }}
      .sig-line {{ border-top: 1px solid #333; text-align:center; padding-top: 3px; font-weight:bold; font-size: 7.2px; float:right; width: 60%; }}
      .sig-cap {{ text-align:center; font-size: 6.2px; color:#555; float:right; width: 60%; }}
      .ftr {{ margin-top: 30px; border-top: 1px solid #c0662a; padding-top: 4px; font-size: 6px; color:#555; display:flex; justify-content:space-between; }}
    </style></head><body>
      <div class="hd">
        <h1>{_html.escape(school_name)} &amp; JUNIOR COLLEGE</h1>
        <div class="sub">{_html.escape(school_address)}</div>
        <div class="sub">{school_contact}</div>
        <div class="tag">Education for a Brighter Tomorrow</div>
      </div>
      <div class="title-bar">
        <div class="t1">PAYMENT EXTENSION APPLICATION</div>
        <div class="t2">REQUEST FOR INSTALLMENT PAYMENT</div>
      </div>
      <div class="date-line">Date: {(ext.get('created_at') or '')[:10]} &nbsp;&nbsp;|&nbsp;&nbsp; Status: {_html.escape((ext.get('status') or '').replace('_',' ').upper())}</div>

      <div class="section">A. Student Details</div>
      <table class="kv">
        <tr><td class="label">Student Name</td><td class="sep">:</td><td>{_html.escape(snap['student_name'] or '')}</td></tr>
        <tr><td class="label">Admission No.</td><td class="sep">:</td><td>{_html.escape(snap['admission_no'] or '')}</td></tr>
        <tr><td class="label">Class</td><td class="sep">:</td><td>{_html.escape(snap['class_name'] or '')} &nbsp;&nbsp; Section: {_html.escape(snap.get('section') or '-')}</td></tr>
        <tr><td class="label">Department / Medium</td><td class="sep">:</td><td>{_html.escape(snap.get('medium') or '')}{(' - ' + snap['stream']) if snap.get('stream') else ''}</td></tr>
      </table>

      <div class="section">B. Fee Details (As Per Current Records)</div>
      <table class="kv fee">
        <tr><td class="label">Total Fee</td><td class="sep">:</td><td class="amt">{inr(snap['total_fee'])}</td></tr>
        <tr><td class="label">Fee Paid Till Now</td><td class="sep">:</td><td class="amt">{inr(snap['total_paid'])}</td></tr>
        <tr><td class="label">Outstanding / Remaining Fee</td><td class="sep">:</td><td class="amt">{inr(snap['current_balance'])}</td></tr>
      </table>

      <div class="section">C. {'Approved' if approved else 'Proposed'} Installment Plan (4 Installments)</div>
      <table class="inst"><tr>{inst_cells}</tr></table>

      <div class="section">D. Reason for Payment Extension</div>
      <div class="reason-box">{_html.escape(ext.get('reason') or '')}</div>

      <div class="closing">I request the school management to kindly approve the above payment extension plan.<br/>Thank you.</div>

      <div style="overflow:hidden;">
        <div class="sig-line">Signature of Secretary</div>
      </div>
      <div style="overflow:hidden;">
        <div class="sig-cap">(For Approval)</div>
      </div>

      <div class="ftr"><span>{_html.escape(school_name)} &amp; Junior College, Butibori</span><span>Discipline | Knowledge | Better Future</span></div>
    </body></html>"""

    buf = io.BytesIO()
    pisa.CreatePDF(html_str, dest=buf)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="Payment_Extension_{snap.get("admission_no") or eid}.pdf"'})

# ---------- Reminders ----------
@router.get("/reminders")
async def list_reminders(status: str = "pending", user = Depends(get_current_user)):
    reminders = await db.reminders.find({"status": status}, {"_id":0}).to_list(1000)
    sids = list({r["student_id"] for r in reminders})
    students = {s["id"]: s for s in await db.students.find({"id":{"$in": sids}}, {"_id":0}).to_list(len(sids) or 1)}
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    for r in reminders:
        r["student"] = students.get(r["student_id"])
        due = (r.get("due_date") or "")[:10]
        if due < today: r["bucket"] = "overdue"
        elif due == today: r["bucket"] = "today"
        elif due == tomorrow: r["bucket"] = "tomorrow"
        else: r["bucket"] = "future"
    return reminders

@router.post("/reminders/followup")
async def add_followup(body: ReminderFollowupIn, user = Depends(get_current_user)):
    r = await db.reminders.find_one({"id": body.reminder_id})
    if not r: raise HTTPException(404, "Not found")
    followup = {"id": gen_id(), "remark_type": body.remark_type, "details": body.details, "by": user["name"], "at": now_iso()}
    await db.reminders.update_one({"id": body.reminder_id}, {"$push":{"followups": followup}, "$set":{"last_followup_at": now_iso()}})
    if body.remark_type == "payment_received":
        await db.reminders.update_one({"id": body.reminder_id}, {"$set":{"status":"paid"}})
    await audit(user, "followup", "reminder", body.reminder_id, {"type": body.remark_type})
    return {"ok": True}
