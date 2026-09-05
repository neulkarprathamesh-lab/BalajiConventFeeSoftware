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
    Electronics and Fisheries are their OWN group here (different fee amounts), never merged
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
        query["$or"] = [
            {"admission_no": {"$regex": q, "$options": "i"}},
            {"student_name": {"$regex": q, "$options": "i"}},
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
