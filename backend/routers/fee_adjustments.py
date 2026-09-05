"""Fee Adjustment / Waiver Application workflow (master spec Parts 13-26).

Full lifecycle: Student selected -> auto-filled snapshot -> unique application number
-> Admin/Sir approval or rejection -> (if approved) Operator/Cashier enters the approved
financial implementation (waiver amount, final fee, up to 4 installments) -> installment
payments go through the REAL FeeHub receipt system (never a fake payment) -> application
completes. Every application is a PERMANENT historical record - a new academic year's
application never overwrites an old one, and application numbers are never reused.

The approved waiver amount is mirrored into the existing `adjustments` collection (status
"approved") the moment the operator enters it, so the student's ledger `total_adjusted` -
already correct, already tested - picks it up automatically. No parallel ledger math.
"""
from typing import Any, Dict, List, Optional
from datetime import date
from fastapi import APIRouter, HTTPException, Depends, Response
from core import db, audit, gen_id, get_current_user, now_iso, require_roles, next_fee_adjustment_number

router = APIRouter(prefix="/api", tags=["fee-adjustments"])

ADMIN_ROLE = ("administrator",)
OPERATOR_ROLES = ("administrator", "manager", "accountant", "cashier")
CREATE_ROLES = ("administrator", "manager", "accountant", "cashier")


async def _student_snapshot(sid: str) -> Dict[str, Any]:
    """Everything FeeHub already knows about the student, for Part 15's auto-fill -
    reuses the SAME ledger math the student profile shows, so figures can never disagree."""
    from routers import students as students_router
    fake_user = {"id": "system", "name": "system", "role": "administrator", "email": "system@local"}
    ledger = await students_router.student_ledger(sid, fake_user)
    s = ledger["student"]
    cls = await db.classes.find_one({"id": s.get("class_id")}, {"_id": 0}) if s.get("class_id") else None
    return {
        "student_id": sid,
        "student_name": s.get("name"), "admission_no": s.get("admission_no"),
        "class_name": cls.get("name") if cls else None,
        "section": s.get("section"), "medium": s.get("medium"), "stream": s.get("stream"),
        "academic_year": s.get("academic_year") or "2026-27",
        "total_fee": (ledger.get("fee_structure") or {}).get("total", 0),
        "total_paid": ledger.get("total_paid", 0),
        "total_adjusted": ledger.get("total_adjusted", 0),
        "previous_year_outstanding": ledger.get("opening_balance", 0),
        "current_balance": ledger.get("outstanding", 0),
    }

@router.get("/students/{sid}/fee-adjustment-snapshot")
async def fee_adjustment_snapshot(sid: str, user = Depends(get_current_user)):
    """Part 15 - auto-fill. Called when the operator opens 'New Fee Adjustment Application'
    for a student, so nothing already known to FeeHub has to be retyped."""
    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    return await _student_snapshot(sid)

# ---------------- Create / list / detail ----------------

@router.post("/fee-adjustments")
async def create_fee_adjustment(body: Dict[str, Any], user = Depends(require_roles(*CREATE_ROLES))):
    sid = str(body.get("student_id") or "").strip()
    reason = str(body.get("reason") or "").strip()
    if not sid:
        raise HTTPException(400, "student_id is required")
    if not reason:
        raise HTTPException(400, "A reason is required for every Fee Adjustment application")
    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    snapshot = await _student_snapshot(sid)
    academic_year = snapshot["academic_year"]
    application_no = await next_fee_adjustment_number(academic_year)
    aid = gen_id()
    requested_amount = body.get("requested_adjustment_amount")
    doc = {
        "id": aid, "application_no": application_no, "student_id": sid,
        "snapshot": snapshot, "reason": reason,
        "requested_adjustment_amount": float(requested_amount) if requested_amount not in (None, "") else None,
        "requested_by": {"id": user["id"], "name": user["name"], "role": user["role"]},
        "created_at": now_iso(),
        "status": "pending_approval",
        "admin_decision": None,
        "financials": None,
        "installments": [],
        "linked_adjustment_id": None,
        "completed_at": None,
    }
    await db.fee_adjustment_applications.insert_one(doc)
    await audit(user, "create", "fee_adjustment_application", aid, {"application_no": application_no, "student": snapshot["student_name"], "reason": reason})
    return {k: v for k, v in doc.items() if k != "_id"}

@router.get("/fee-adjustments")
async def list_fee_adjustments(status: Optional[str] = None, student_id: Optional[str] = None,
                                academic_year: Optional[str] = None, user = Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if status: q["status"] = status
    if student_id: q["student_id"] = student_id
    if academic_year: q["snapshot.academic_year"] = academic_year
    return await db.fee_adjustment_applications.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)

# ---------------- Reminders (derived, not a separate stored collection) ----------------
# Registered here, BEFORE /fee-adjustments/{aid}, so the literal path "reminders" is never
# swallowed by the {aid} parameter route.

@router.get("/fee-adjustments/reminders")
async def installment_reminders(user = Depends(get_current_user)):
    """Part 21. Statuses are computed live from due_date vs today - never a stale stored
    reminder, so an installment paid through the normal receipt flow disappears from here
    immediately with no separate cleanup step, and nothing is ever duplicated."""
    today = date.today().isoformat()
    apps = await db.fee_adjustment_applications.find(
        {"status": {"$in": ["active", "completed"]}, "installments.0": {"$exists": True}}, {"_id": 0},
    ).to_list(2000)
    out = []
    for a in apps:
        for inst in a.get("installments", []):
            if inst["status"] == "paid":
                reminder_status = "PAID"
            elif inst["due_date"] < today:
                reminder_status = "OVERDUE"
            elif inst["due_date"] == today:
                reminder_status = "DUE TODAY"
            else:
                reminder_status = "UPCOMING"
            out.append({
                "application_id": a["id"], "application_no": a["application_no"],
                "student_id": a["student_id"], "student_name": a["snapshot"]["student_name"],
                "admission_no": a["snapshot"]["admission_no"], "academic_year": a["snapshot"]["academic_year"],
                "installment_no": inst["installment_no"], "amount": inst["amount"], "due_date": inst["due_date"],
                "status": reminder_status, "receipt_number": inst.get("receipt_number"),
            })
    return out

@router.get("/fee-adjustments/{aid}")
async def get_fee_adjustment(aid: str, user = Depends(get_current_user)):
    doc = await db.fee_adjustment_applications.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc

@router.get("/students/{sid}/fee-adjustments")
async def student_fee_adjustment_history(sid: str, user = Depends(get_current_user)):
    """Part 16 - the student's permanent Fee Adjustment history, across every academic year."""
    return await db.fee_adjustment_applications.find({"student_id": sid}, {"_id": 0}).sort("created_at", -1).to_list(200)

# ---------------- Admin approval / rejection ----------------

@router.post("/fee-adjustments/{aid}/approve")
async def approve_fee_adjustment(aid: str, user = Depends(require_roles(*ADMIN_ROLE))):
    doc = await db.fee_adjustment_applications.find_one({"id": aid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] != "pending_approval":
        raise HTTPException(409, f"Application is '{doc['status']}' - only a pending application can be approved")
    decision = {"decision": "approved", "by": {"id": user["id"], "name": user["name"]}, "at": now_iso()}
    await db.fee_adjustment_applications.update_one(
        {"id": aid}, {"$set": {"status": "approved_pending_entry", "admin_decision": decision}},
    )
    await audit(user, "approve", "fee_adjustment_application", aid, {"application_no": doc["application_no"]})
    return {"ok": True, "status": "approved_pending_entry"}

@router.post("/fee-adjustments/{aid}/reject")
async def reject_fee_adjustment(aid: str, body: Dict[str, Any], user = Depends(require_roles(*ADMIN_ROLE))):
    doc = await db.fee_adjustment_applications.find_one({"id": aid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] != "pending_approval":
        raise HTTPException(409, f"Application is '{doc['status']}' - only a pending application can be rejected")
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A rejection reason is required")
    decision = {"decision": "rejected", "by": {"id": user["id"], "name": user["name"]}, "at": now_iso(), "rejection_reason": reason}
    await db.fee_adjustment_applications.update_one(
        {"id": aid}, {"$set": {"status": "rejected", "admin_decision": decision}},
    )
    await audit(user, "reject", "fee_adjustment_application", aid, {"application_no": doc["application_no"], "reason": reason})
    return {"ok": True, "status": "rejected"}

# ---------------- Operator/Cashier financial entry ----------------

@router.post("/fee-adjustments/{aid}/financials")
async def enter_fee_adjustment_financials(aid: str, body: Dict[str, Any], user = Depends(require_roles(*OPERATOR_ROLES))):
    """Part 19-20. Only usable once Admin has approved. The operator can never touch the
    approval decision or reason - those fields simply aren't accepted here."""
    doc = await db.fee_adjustment_applications.find_one({"id": aid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] != "approved_pending_entry":
        raise HTTPException(409, f"Application is '{doc['status']}' - financial details can only be entered once Admin has approved and before entry is completed")

    try:
        original_fee = float(body.get("original_fee"))
        adjustment_amount = float(body.get("adjustment_amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "original_fee and adjustment_amount must be numbers")
    if original_fee < 0 or adjustment_amount < 0:
        raise HTTPException(400, "Amounts cannot be negative")
    if adjustment_amount > original_fee:
        raise HTTPException(400, "Adjustment amount cannot exceed the original fee")
    final_fee = round(original_fee - adjustment_amount, 2)

    amount_already_paid = float(body.get("amount_already_paid") or doc["snapshot"].get("total_paid", 0))
    remaining_amount = round(max(0.0, final_fee - amount_already_paid), 2)

    raw_installments = body.get("installments") or []
    if len(raw_installments) > 4:
        raise HTTPException(400, "A maximum of 4 installments is allowed")
    installments = []
    total_installments = 0.0
    for idx, inst in enumerate(raw_installments):
        try:
            amt = float(inst.get("amount"))
        except (TypeError, ValueError):
            raise HTTPException(400, f"Installment {idx+1}: amount must be a number")
        due = str(inst.get("due_date") or "").strip()
        if amt <= 0:
            raise HTTPException(400, f"Installment {idx+1}: amount must be positive")
        if not due:
            raise HTTPException(400, f"Installment {idx+1}: due date is required")
        total_installments += amt
        installments.append({
            "installment_no": idx + 1, "amount": amt, "due_date": due,
            "status": "unpaid", "paid_at": None, "receipt_id": None, "receipt_number": None,
            "payment_mode": None, "transaction_id": None,
        })
    if total_installments - remaining_amount > 0.01:
        raise HTTPException(400, f"Installment total (Rs. {total_installments:,.2f}) cannot exceed the remaining amount (Rs. {remaining_amount:,.2f})")

    financials = {
        "original_fee": original_fee, "adjustment_amount": adjustment_amount, "final_fee": final_fee,
        "amount_already_paid": amount_already_paid, "remaining_amount": remaining_amount,
        "entered_by": {"id": user["id"], "name": user["name"]}, "entered_at": now_iso(),
    }

    # Mirror into the existing adjustments collection (already-correct, already-tested ledger
    # math) so the student's Outstanding reflects this waiver immediately - never a duplicate,
    # never a fake receipt.
    adj_id = gen_id()
    await db.adjustments.insert_one({
        "id": adj_id, "student_id": doc["student_id"], "adjustment_type": "fee_adjustment_application",
        "amount": adjustment_amount,
        "reason": f"Fee Adjustment Application {doc['application_no']}: {doc['reason']}",
        "fee_head_id": None, "status": "approved",
        "requested_by": doc["requested_by"]["id"], "requested_by_name": doc["requested_by"]["name"],
        "approved_by": user["id"], "approved_by_name": user["name"], "approved_at": now_iso(),
        "fee_adjustment_application_id": aid, "application_no": doc["application_no"],
        "created_at": now_iso(),
    })

    new_status = "completed" if remaining_amount <= 0.004 else "active"
    update: Dict[str, Any] = {
        "financials": financials, "installments": installments,
        "linked_adjustment_id": adj_id, "status": new_status,
    }
    if new_status == "completed":
        update["completed_at"] = now_iso()
    await db.fee_adjustment_applications.update_one({"id": aid}, {"$set": update})
    await audit(user, "enter_financials", "fee_adjustment_application", aid, {
        "application_no": doc["application_no"], "adjustment_amount": adjustment_amount,
        "final_fee": final_fee, "remaining_amount": remaining_amount, "installments": len(installments),
    })
    return await db.fee_adjustment_applications.find_one({"id": aid}, {"_id": 0})

# ---------------- Installment payment (real receipt, never fake) ----------------

@router.post("/fee-adjustments/{aid}/installments/{no}/pay")
async def pay_installment(aid: str, no: int, body: Dict[str, Any], user = Depends(require_roles(*OPERATOR_ROLES))):
    """Part 22 - the parent pays an installment. This creates a REAL receipt through the
    normal FeeHub receipt system (real receipt number, appears in Receipts, counted in daily
    collection) and only then marks the installment paid, linked to that real receipt."""
    from core import ReceiptIn, ReceiptLineIn
    from routers.receipts import create_receipt

    doc = await db.fee_adjustment_applications.find_one({"id": aid})
    if not doc:
        raise HTTPException(404, "Not found")
    inst = next((i for i in doc.get("installments", []) if i["installment_no"] == no), None)
    if not inst:
        raise HTTPException(404, f"Installment {no} not found on this application")
    if inst["status"] == "paid":
        raise HTTPException(409, f"Installment {no} is already marked paid (receipt {inst.get('receipt_number')})")

    payment_mode = str(body.get("payment_mode") or "cash")
    transaction_id = body.get("transaction_id")
    student = await db.students.find_one({"id": doc["student_id"]}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")

    receipt_body = ReceiptIn(
        receipt_type="school",
        department_id=student["department_id"],
        student_id=doc["student_id"],
        purpose=f"Fee Adjustment Installment {no} - Application {doc['application_no']}",
        payment_mode=payment_mode if payment_mode in ("cash","cheque","dd","upi","neft","card","other") else "other",
        payment_reference=transaction_id,
        lines=[ReceiptLineIn(
            fee_head_name=f"Fee Adjustment Installment {no} ({doc['application_no']})",
            amount=float(inst["amount"]),
            installment=f"FA Installment {no}",
        )],
        remarks=f"Installment payment for Fee Adjustment Application {doc['application_no']}",
        metadata={"fee_adjustment_application_id": aid, "installment_no": no},
    )
    receipt = await create_receipt(receipt_body, user)

    updated_installments = []
    for i in doc["installments"]:
        if i["installment_no"] == no:
            i = {**i, "status": "paid", "paid_at": now_iso(), "receipt_id": receipt["id"],
                 "receipt_number": receipt["number"], "payment_mode": payment_mode, "transaction_id": transaction_id}
        updated_installments.append(i)
    all_paid = all(i["status"] == "paid" for i in updated_installments)
    update: Dict[str, Any] = {"installments": updated_installments}
    if all_paid and doc["status"] == "active":
        update["status"] = "completed"
        update["completed_at"] = now_iso()
    await db.fee_adjustment_applications.update_one({"id": aid}, {"$set": update})
    await audit(user, "installment_paid", "fee_adjustment_application", aid, {
        "application_no": doc["application_no"], "installment_no": no,
        "amount": inst["amount"], "receipt_number": receipt["number"],
    })
    return await db.fee_adjustment_applications.find_one({"id": aid}, {"_id": 0})

# ---------------- Printed application (one A4 page, per the reference design) ----------------

@router.get("/fee-adjustments/{aid}/pdf")
async def fee_adjustment_pdf(aid: str, user = Depends(get_current_user)):
    import io, html as _html
    from xhtml2pdf import pisa

    doc = await db.fee_adjustment_applications.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    snap = doc["snapshot"]
    fin = doc.get("financials")
    insts = doc.get("installments", [])

    def inr(n):
        try: return "Rs. {:,.2f}".format(float(n))
        except Exception: return "-"

    # Column widths as explicit inline pt styles on every cell (header AND body) - the only
    # sizing hint xhtml2pdf's table layout honors reliably for an imbalanced 3-column table.
    COL_W = ('width:300pt;', 'width:108pt;', 'width:108pt;')
    inst_rows = ""
    for n in range(1, 5):
        i = next((x for x in insts if x["installment_no"] == n), None)
        due = i["due_date"] if i else ""
        amt = inr(i["amount"]) if i else ""
        suffix = {1: "st", 2: "nd", 3: "rd", 4: "th"}[n]
        inst_rows += f"""<tr><td class='b' style='{COL_W[0]}'>{n}{suffix} Installment</td>
            <td style='{COL_W[1]}'>{_html.escape(due)}</td><td class='r' style='{COL_W[2]}'>{amt}</td></tr>"""

    # Only what FeeHub already knows for certain - Student Details, Total Fee, Amount Paid -
    # is auto-filled. The Adjustment Amount / Final Fee / Remaining Amount are decisions nobody
    # has made yet until the Operator enters them post-approval, so the form prints them BLANK
    # for the Admin/Cashier to hand-write, exactly like the installment schedule already does.
    original_fee = fin["original_fee"] if fin else snap["total_fee"]
    already_paid = fin["amount_already_paid"] if fin else snap["total_paid"]
    adjustment_amount_str = inr(fin["adjustment_amount"]) if fin else ""
    final_fee_str = inr(fin["final_fee"]) if fin else ""
    remaining_str = inr(fin["remaining_amount"]) if fin else ""

    admin_dec = doc.get("admin_decision")
    admin_line = f"Approved by {_html.escape(admin_dec['by']['name'])} on {admin_dec['at'][:10]}" if admin_dec and admin_dec.get("decision") == "approved" else "Pending"

    html_str = f"""<html><head><style>
      @page {{ size: A4; margin: 14mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #111; }}
      h1 {{ font-size: 16px; text-align:center; margin: 0; }}
      .sub {{ text-align:center; font-size: 10px; color:#444; margin-bottom: 8px; }}
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
      .reason-line {{ border-bottom: 1px solid #333; line-height: 22px; margin-bottom: 6px; }}
      table.installments {{ width:100%; border-collapse: collapse; margin-bottom: 8px; }}
      table.installments td, table.installments th {{ border: 1px solid #999; padding: 4px 6px; font-size: 10.5px; }}
      table.installments th {{ background:#f0f0f0; text-align:left; }}
      table.sig {{ width:100%; border-collapse: collapse; margin-top: 34px; }}
      table.sig td {{ width:50%; text-align:center; border-top: 1px solid #333; padding-top: 5px; font-weight: bold; font-size: 10.5px; }}
      table.sig .cap {{ font-weight: normal; font-size: 9px; color:#333; }}
    </style></head><body>
    <h1>BALAJI CONVENT &amp; JUNIOR COLLEGE</h1>
    <div class="sub">BUTIBORI, DIST. NAGPUR</div>
    <div style="text-align:center;"><span class="app-no">FEE ADJUSTMENT APPLICATION &nbsp;·&nbsp; {_html.escape(doc['application_no'])}</span></div>

    <table class="details">
      <tr><td class="label">Student Name</td><td class="b">{_html.escape(snap['student_name'] or '')}</td>
          <td class="label">Admission No.</td><td class="b">{_html.escape(snap['admission_no'] or '')}</td></tr>
      <tr><td class="label">Class</td><td>{_html.escape(snap['class_name'] or '')}{(' / ' + snap['section']) if snap.get('section') else ''}</td>
          <td class="label">Medium</td><td>{_html.escape(snap['medium'] or '')}{(' - ' + snap['stream']) if snap.get('stream') else ''}</td></tr>
      <tr><td class="label">Academic Year</td><td>{_html.escape(snap['academic_year'] or '')}</td>
          <td class="label">Application Date</td><td>{doc['created_at'][:10]}</td></tr>
    </table>

    <div class="section-title">Fee Details</div>
    <table class="fee">
      <tr><th>Original Fee</th><th>Adjustment Amount</th><th>Final Fee After Adjustment</th><th>Amount Already Paid</th><th>Remaining Amount</th></tr>
      <tr><td class="r">{inr(original_fee)}</td><td class="r">{adjustment_amount_str or "&nbsp;"}</td><td class="r b">{final_fee_str or "&nbsp;"}</td><td class="r">{inr(already_paid)}</td><td class="r b">{remaining_str or "&nbsp;"}</td></tr>
    </table>

    <div class="section-title">Reason for Adjustment</div>
    <div class="reason-line">&nbsp;</div>
    <div class="reason-line">&nbsp;</div>
    <div class="reason-line">&nbsp;</div>
    <div class="reason-line">&nbsp;</div>

    <div class="section-title">Installment Payment Request</div>
    <table class="installments">
      <tr><th style='{COL_W[0]}'>Installment</th><th style='{COL_W[1]}'>Due&nbsp;Date</th><th style='{COL_W[2]}'>Amount</th></tr>
      {inst_rows}
    </table>

    <div style="font-size:10px; color:#555; margin-top:6px;">Admin decision: {admin_line}</div>

    <table class="sig">
      <tr>
        <td>ADMIN<br/><span class="cap">Signature &amp; Date</span></td>
        <td>CASHIER<br/><span class="cap">Signature &amp; Date</span></td>
      </tr>
    </table>
    </body></html>"""

    buf = io.BytesIO()
    pisa.CreatePDF(html_str, dest=buf)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="{doc["application_no"]}.pdf"'})
