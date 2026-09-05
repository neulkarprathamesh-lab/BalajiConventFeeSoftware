"""Receipt Types (DB-backed) + Receipts + Adjustments + Extensions + Reminders + cancel/reprint."""
from typing import Any, Dict, List, Optional, Literal
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Depends
from core import (
    db, ReceiptTypeIn, ReceiptIn, AdjustmentIn, ExtensionIn, ReminderFollowupIn,
    audit, gen_id, get_current_user, now_iso, require_roles,
    require_admin_pin, require_admin_dual, get_settings_doc,
    next_receipt_number, next_voucher_number, amount_in_words_inr,
    DEFAULT_RECEIPT_TYPES, _seed_receipt_types_if_empty,
)

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
    total = sum(l.amount for l in body.lines)

    # ---- Business rules ---------------------------------------------------
    # Admission Fee is a one-time-only line per student per academic year.
    # Continuation Fee must be paid in full — no partial payments allowed.
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
        if "continuation fee" in line_names and student.get("fee_structure_id"):
            fs = await db.fee_structures.find_one({"id": student["fee_structure_id"]}, {"_id":0})
            expected = float(fs.get("continuation_fee", 0)) if fs else 0
            paid_line = next((l for l in body.lines if (l.fee_head_name or "").strip().lower() == "continuation fee"), None)
            if expected > 0 and paid_line and abs(float(paid_line.amount) - expected) > 0.01:
                raise HTTPException(400, f"Continuation Fee must be paid in full (₹{int(expected)}). Partial payments are not allowed.")

    if body.receipt_type in ("refund","debit_voucher"):
        if user["role"] not in ("administrator","manager"):
            raise HTTPException(403, "Refund/voucher requires manager or admin")
    ay = dept.get("academic_year", "2026-27")
    if body.receipt_type == "debit_voucher":
        number = await next_voucher_number(ay)
    else:
        number = await next_receipt_number(dept["code"], ay)
    rid = gen_id()
    # Rich student snapshot so receipts always self-describe (survives student edits)
    snapshot = None
    if student:
        class_doc = await db.classes.find_one({"id": student.get("class_id")}, {"_id":0}) if student.get("class_id") else None
        fs_doc = await db.fee_structures.find_one({"id": student.get("fee_structure_id")}, {"_id":0, "items":0}) if student.get("fee_structure_id") else None
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
            "academic_year": student.get("academic_year") or ay,
            "fee_structure_name": (f"{fs_doc.get('medium')} · {fs_doc.get('class_name')}"
                                    + (f" · {fs_doc.get('stream')}" if fs_doc and fs_doc.get('stream') else "")) if fs_doc else None,
        }
    # Explicit receipt-TEMPLATE selection (EP/MP/SEC/JC/JC-ACS/EMP/EMJC/BUS/V) is
    # independent of receipt_type (business rules) and department_id (whose money
    # this is), but it must still make sense for that student - never let an
    # English Primary student's payment go out under a "Junior College" template.
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
    if q: query["number"] = {"$regex": q, "$options": "i"}
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
async def reprint_receipt(rid: str, user = Depends(get_current_user)):
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

# ---------- Adjustments ----------
@router.post("/adjustments")
async def create_adjustment(body: AdjustmentIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    aid = gen_id()
    doc = {"id": aid, **body.model_dump(), "status":"pending", "requested_by": user["id"], "requested_by_name": user["name"], "created_at": now_iso()}
    await db.adjustments.insert_one(doc)
    await audit(user, "create", "adjustment", aid, {"amount": body.amount, "type": body.adjustment_type})
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

# ---------- Extensions ----------
@router.post("/extensions")
async def create_extension(body: ExtensionIn, user = Depends(require_roles("administrator","manager","accountant","cashier"))):
    if len(body.installments) > 4:
        raise HTTPException(400, "Max 4 installments allowed")
    total = sum(float(i.get("amount",0)) for i in body.installments)
    if abs(total - body.outstanding_amount) > 0.01:
        raise HTTPException(400, f"Installments total (₹{total}) must equal outstanding (₹{body.outstanding_amount})")
    eid = gen_id()
    doc = {"id": eid, **body.model_dump(), "status":"pending", "requested_by": user["id"], "requested_by_name": user["name"], "created_at": now_iso()}
    await db.extensions.insert_one(doc)
    await audit(user, "create", "extension", eid, {"amount": total})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.get("/extensions")
async def list_extensions(status: Optional[str] = None, student_id: Optional[str] = None, user = Depends(get_current_user)):
    q = {}
    if status: q["status"] = status
    if student_id: q["student_id"] = student_id
    return await db.extensions.find(q, {"_id":0}).sort("created_at", -1).to_list(500)

@router.post("/extensions/{eid}/approve")
async def approve_extension(eid: str, user = Depends(require_roles("administrator","manager"))):
    ext = await db.extensions.find_one({"id": eid})
    if not ext: raise HTTPException(404, "Not found")
    await db.extensions.update_one({"id": eid}, {"$set":{"status":"approved","approved_by_name": user["name"],"approved_at": now_iso()}})
    for idx, inst in enumerate(ext.get("installments", [])):
        await db.reminders.insert_one({
            "id": gen_id(), "extension_id": eid, "student_id": ext["student_id"],
            "installment_index": idx, "installment_name": inst.get("name") or f"Installment {idx+1}",
            "amount": float(inst.get("amount",0)), "due_date": inst.get("due_date"),
            "status": "pending", "created_at": now_iso(),
        })
    await audit(user, "approve", "extension", eid)
    return {"ok": True}

@router.post("/extensions/{eid}/reject")
async def reject_extension(eid: str, body: Dict[str,str], user = Depends(require_roles("administrator","manager"))):
    await db.extensions.update_one({"id": eid}, {"$set":{"status":"rejected","reject_reason": body.get("reason",""),"approved_by_name": user["name"],"approved_at": now_iso()}})
    await audit(user, "reject", "extension", eid)
    return {"ok": True}

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
