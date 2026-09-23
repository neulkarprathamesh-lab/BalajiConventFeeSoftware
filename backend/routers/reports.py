"""Dashboard, reports (collection, audit, cancellations, concessions, defaulters, day-end),
bus routes, outstanding notices, quarterly reminders trigger, public lookups (no-auth)."""
import os, hmac, asyncio, re
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, List, Optional, Literal
from fastapi import APIRouter, HTTPException, Depends, Request
from core import (
    db, BusRouteIn, audit, gen_id, get_current_user, get_settings_doc,
    now_iso, require_roles, _generate_quarterly_reminders, APP_ROOT,
)

router = APIRouter(prefix="/api", tags=["reports"])

# ---------- Dashboard ----------
@router.get("/dashboard")
async def dashboard(user = Depends(get_current_user)):
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    today_bound = {"$gte": today, "$lt": tomorrow}  # same boundary used everywhere below - Today's
    # Collection, Receipts Today, and Recent Receipts must never disagree about what "today" means.
    receipts_today = await db.receipts.find({"created_at": today_bound, "status":{"$ne":"cancelled"}}, {"_id":0}).to_list(2000)
    collection_today = sum(r.get("total",0) for r in receipts_today if r.get("receipt_type") not in ("refund","debit_voucher"))
    pending_adj = await db.adjustments.count_documents({"status":"pending"})
    pending_ext = await db.extensions.count_documents({"status":"pending"})
    reminders = await db.reminders.find({"status":"pending"}, {"_id":0}).to_list(2000)
    due_today = sum(1 for r in reminders if (r.get("due_date") or "")[:10] == today)
    due_tomorrow = sum(1 for r in reminders if (r.get("due_date") or "")[:10] == tomorrow)
    overdue = sum(1 for r in reminders if (r.get("due_date") or "")[:10] < today)
    # Recent Receipts - previously had NO date filter at all (just newest-10 overall), which
    # silently backfilled with older days' receipts whenever today had fewer than 10. Now
    # scoped to the exact same today_bound as Today's Collection/Receipts Today above, so an
    # older receipt can never appear here regardless of how many receipts exist today.
    recent = await db.receipts.find({"created_at": today_bound}, {"_id":0}).sort("created_at",-1).limit(20).to_list(20)
    dept_totals: Dict[str,float] = {}
    for r in receipts_today:
        if r.get("receipt_type") in ("refund","debit_voucher"): continue
        dept_totals[r.get("department_name","-")] = dept_totals.get(r.get("department_name","-"),0) + r.get("total",0)
    return {
        "collection_today": collection_today,
        "receipts_today_count": len([x for x in receipts_today if x.get("receipt_type") not in ("refund","debit_voucher")]),
        "pending_approvals": pending_adj + pending_ext,
        "pending_adjustments": pending_adj, "pending_extensions": pending_ext,
        "pending_big_waivers": await db.adjustments.count_documents({"status":"pending","amount":{"$gt": float((await get_settings_doc()).get("manager_waiver_cap", 5000) or 5000)}}),
        "due_today": due_today, "due_tomorrow": due_tomorrow, "overdue": overdue,
        "recent_receipts": recent,
        "dept_totals_today": [{"department": k, "total": v} for k,v in dept_totals.items()],
    }

# ---------- Reports ----------
@router.get("/reports/collection/cashiers")
async def collection_report_cashiers(user = Depends(get_current_user)):
    """Dynamically derives the 'Issued/Printed By' filter list from who has
    actually issued a receipt - never a hard-coded name list, so a new
    cashier/admin appears automatically and nobody has to remember to add
    them anywhere."""
    pipeline = [
        {"$match": {"cashier_id": {"$ne": None}}},
        {"$group": {"_id": "$cashier_id", "name": {"$last": "$cashier_name"}}},
        {"$sort": {"name": 1}},
    ]
    rows = await db.receipts.aggregate(pipeline).to_list(200)
    return [{"cashier_id": r["_id"], "cashier_name": r["name"]} for r in rows if r["_id"]]


@router.get("/reports/collection")
async def collection_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department_id: Optional[str] = None, cashier_id: Optional[str] = None,
    receipt_type_id: Optional[str] = None, format: str = "json",
    user = Depends(get_current_user),
):
    """`receipt_type_id` filters by the receipt TEMPLATE actually used (EP/MP/
    EMP/SEC/JC/JCACS/BUS/EMJC/DV, from the receipt_types collection) — distinct
    from `receipt_type` (the business-rule field: school/bus/refund/etc, still
    shown unchanged in `by_type` below). `cashier_id` filters by the receipt's
    OWN `cashier_id` - the user who actually issued/printed it at creation
    time, which a later reprint (see receipts.py's /reprint) never changes.
    It is applied to the SAME base query every downstream figure
    (gross/refunds/vouchers/net/by_mode/by_type/rows/count) is computed from,
    so the whole report — not just the transaction table — reflects the
    filter."""
    today = date.today().isoformat()
    if not date_from: date_from = today
    if not date_to: date_to = today
    q: Dict[str, Any] = {"created_at":{"$gte": date_from, "$lte": date_to + "T23:59:59"}, "status":{"$ne":"cancelled"}}
    if department_id: q["department_id"] = department_id
    if cashier_id: q["cashier_id"] = cashier_id
    receipt_type_label = "All Receipt Types"
    if receipt_type_id:
        q["receipt_type_id"] = receipt_type_id
        rt = await db.receipt_types.find_one({"id": receipt_type_id}, {"_id": 0, "code": 1, "name": 1})
        receipt_type_label = f"{rt['code']} — {rt['name']}" if rt else "Unknown Receipt Type"
    rows = await db.receipts.find(q, {"_id":0}).sort("created_at",1).to_list(5000)
    total = sum(r.get("total",0) for r in rows if r.get("receipt_type") not in ("refund","debit_voucher"))
    refund = sum(r.get("total",0) for r in rows if r.get("receipt_type") == "refund")
    vouchers = sum(r.get("total",0) for r in rows if r.get("receipt_type") == "debit_voucher")
    by_mode: Dict[str,float] = {}; by_type: Dict[str,float] = {}
    for r in rows:
        if r.get("receipt_type") in ("refund","debit_voucher"): continue
        by_mode[r.get("payment_mode","-")] = by_mode.get(r.get("payment_mode","-"),0) + r.get("total",0)
        by_type[r.get("receipt_type","-")] = by_type.get(r.get("receipt_type","-"),0) + r.get("total",0)
    net = total - refund - vouchers
    cashier_label = "All"
    if cashier_id:
        first_hit = next((r for r in rows if r.get("cashier_id") == cashier_id), None)
        cashier_label = first_hit["cashier_name"] if first_hit else (await db.receipts.find_one({"cashier_id": cashier_id}, {"cashier_name": 1}) or {}).get("cashier_name", cashier_id)

    if format == "json":
        return {"rows": rows, "gross_collection": total, "refunds": refund, "vouchers": vouchers,
                "net": net, "by_mode": by_mode, "by_type": by_type, "count": len(rows),
                "receipt_type_id": receipt_type_id, "receipt_type_label": receipt_type_label,
                "cashier_id": cashier_id, "cashier_label": cashier_label}

    school = await get_settings_doc()
    period = f"{date_from} to {date_to}"
    subtitle = f"Period: {period} | Receipt Type: {receipt_type_label} | Issued/Printed By: {cashier_label}"

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        from fastapi import Response
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Collection Report"
        ws.append([(school.get("school_name") or "BALAJI CONVENT").upper()])
        ws.append(["COLLECTION REPORT"])
        ws.append([subtitle])
        ws.append([])
        header_row = ws.max_row + 1
        ws.append(["S.No", "Receipt No.", "Type", "Payer", "Department", "Mode", "Amount", "Issued/Printed By"])
        for cell in ws[header_row]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for i, r in enumerate(rows, 1):
            ws.append([i, r.get("number"), (r.get("receipt_type") or "").replace("_", " "), r.get("payer_name"),
                       r.get("department_code"), (r.get("payment_mode") or "").upper(), r.get("total", 0), r.get("cashier_name")])
        ws.append([])
        ws.append(["", "", "", "", "", "Gross Collection", total])
        ws.append(["", "", "", "", "", "Refunds", refund])
        ws.append(["", "", "", "", "", "Vouchers Out", vouchers])
        ws.append(["", "", "", "", "", "NET", net])
        for row in ws.iter_rows(min_row=ws.max_row - 3, max_row=ws.max_row):
            for cell in row: cell.font = Font(bold=True)
        for idx, w in enumerate([6, 16, 14, 22, 12, 10, 14, 20], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": f'attachment; filename="Collection_Report_{date_from}_{date_to}.xlsx"'})

    if format == "pdf":
        import io, html as _html
        from xhtml2pdf import pisa
        from fastapi import Response
        trs = "".join(
            f"<tr><td>{i}</td><td>{_html.escape(r.get('number') or '')}</td><td>{_html.escape((r.get('receipt_type') or '').replace('_',' '))}</td>"
            f"<td>{_html.escape(r.get('payer_name') or '')}</td><td>{_html.escape(r.get('department_code') or '')}</td>"
            f"<td>{_html.escape((r.get('payment_mode') or '').upper())}</td><td class='r'>{r.get('total',0):,.2f}</td>"
            f"<td>{_html.escape(r.get('cashier_name') or '')}</td></tr>"
            for i, r in enumerate(rows, 1)
        ) or "<tr><td colspan='8' style='text-align:center;color:#888;'>No transactions for this filter.</td></tr>"
        html_str = f"""<html><head><style>
          @page {{ size: A4 landscape; margin: 12mm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; font-size: 9px; }}
          h1 {{ font-size: 14px; text-align:center; margin: 0; }}
          h2 {{ font-size: 11px; text-align:center; margin: 3px 0; color:#444; font-weight:normal; }}
          table {{ width:100%; border-collapse: collapse; margin-top: 8px; }}
          th {{ background:#1e293b; color:#fff; border: 1px solid #999; padding: 3px 4px; text-align:left; }}
          td {{ border: 1px solid #ccc; padding: 3px 4px; word-break: break-word; }}
          td.r, th.r {{ text-align:right; font-family: monospace; }}
          tr.total td {{ font-weight: bold; border-top: 1.5px solid #333; background:#f7f7f7; }}
          col.c-sno {{ width: 5%; }} col.c-no {{ width: 14%; }} col.c-type {{ width: 10%; }}
          col.c-payer {{ width: 22%; }} col.c-dept {{ width: 8%; }} col.c-mode {{ width: 9%; }}
          col.c-amt {{ width: 14%; }} col.c-by {{ width: 18%; }}
        </style></head><body>
          <h1>{_html.escape((school.get('school_name') or 'BALAJI CONVENT').upper())}</h1>
          <h2>Collection Report &mdash; {_html.escape(subtitle)}</h2>
          <table>
            <colgroup><col class="c-sno"/><col class="c-no"/><col class="c-type"/><col class="c-payer"/><col class="c-dept"/><col class="c-mode"/><col class="c-amt"/><col class="c-by"/></colgroup>
            <thead><tr><th>S.No</th><th>Receipt No.</th><th>Type</th><th>Payer</th><th>Dept</th><th>Mode</th><th class="r">Amount</th><th>Issued/Printed By</th></tr></thead>
            <tbody>{trs}</tbody>
          </table>
          <table style="margin-top:6px;">
            <colgroup><col style="width:70%"/><col style="width:30%"/></colgroup>
            <tr><td>Gross Collection</td><td class="r">{total:,.2f}</td></tr>
            <tr><td>Refunds</td><td class="r">{refund:,.2f}</td></tr>
            <tr><td>Vouchers Out</td><td class="r">{vouchers:,.2f}</td></tr>
            <tr class="total"><td>NET</td><td class="r">{net:,.2f}</td></tr>
          </table>
        </body></html>"""
        buf = io.BytesIO(); pisa.CreatePDF(html_str, dest=buf)
        return Response(content=buf.getvalue(), media_type="application/pdf",
                         headers={"Content-Disposition": f'inline; filename="Collection_Report_{date_from}_{date_to}.pdf"'})

    raise HTTPException(400, f"Unknown format '{format}' - use json, csv or xlsx")

@router.get("/reports/audit")
async def audit_report(limit: int = 500, user = Depends(require_roles("administrator","manager","accountant"))):
    return await db.audit_log.find({}, {"_id":0}).sort("timestamp",-1).limit(limit).to_list(limit)

@router.get("/reports/cancellations")
async def cancellation_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    user = Depends(require_roles("administrator","manager","accountant")),
):
    today = date.today().isoformat()
    if not date_from: date_from = "2000-01-01"
    if not date_to: date_to = today
    q = {"status": "cancelled", "cancelled_at": {"$gte": date_from, "$lte": date_to + "T23:59:59"}}
    rows = await db.receipts.find(q, {"_id":0}).sort("cancelled_at", -1).to_list(2000)
    total = sum(r.get("total",0) for r in rows)
    return {"rows": rows, "count": len(rows), "total_cancelled": total}

@router.get("/reports/concessions")
async def concession_ledger(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    department_id: Optional[str] = None,
    format: str = "json",
    user = Depends(require_roles("administrator","manager","accountant")),
):
    """format=json|csv|xlsx|pdf — export always reflects the SAME filtered rows the
    Concession Ledger screen shows (same date_from/date_to/department_id query)."""
    today = date.today().isoformat()
    if not date_from: date_from = today[:7] + "-01"
    if not date_to: date_to = today
    q: Dict[str, Any] = {"status": "approved", "approved_at": {"$gte": date_from, "$lte": date_to + "T23:59:59"}}
    rows = await db.adjustments.find(q, {"_id":0}).sort("approved_at", -1).to_list(5000)
    sids = list({r["student_id"] for r in rows if r.get("student_id")})
    students = {s["id"]: s for s in await db.students.find({"id":{"$in": sids}}, {"_id":0}).to_list(len(sids) or 1)}
    if department_id:
        rows = [r for r in rows if students.get(r.get("student_id"), {}).get("department_id") == department_id]
    for r in rows:
        r["student"] = students.get(r.get("student_id"))
    total = sum(r.get("amount", 0) for r in rows)
    by_type: Dict[str, float] = {}; by_month: Dict[str, float] = {}
    for r in rows:
        t = r.get("adjustment_type","-")
        by_type[t] = by_type.get(t, 0) + r.get("amount", 0)
        m = (r.get("approved_at") or "")[:7]
        by_month[m] = by_month.get(m, 0) + r.get("amount", 0)

    if format == "json":
        return {"rows": rows, "count": len(rows), "total": total, "by_type": by_type, "by_month": by_month}

    def _fmt_row(i, r):
        s = r.get("student") or {}
        return [
            i, s.get("name","-"), s.get("admission_no","-"),
            (r.get("adjustment_type","-") or "-").replace("_"," "),
            r.get("reason",""), r.get("amount",0), r.get("approved_by_name",""),
            (r.get("approved_at") or "")[:10],
        ]
    headers = ["#","Student","Adm No","Type","Reason","Amount","Approved By","Date"]

    if format == "csv":
        import io, csv as _csv
        from fastapi import Response
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(headers)
        for i, r in enumerate(rows, 1):
            w.writerow(_fmt_row(i, r))
        return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                         headers={"Content-Disposition": f'attachment; filename="Concession_Ledger_{date_from}_to_{date_to}.csv"'})

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        from fastapi import Response
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Concession Ledger"
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for i, r in enumerate(rows, 1):
            ws.append(_fmt_row(i, r))
        for idx, w in enumerate([5,22,14,16,34,12,20,12], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": f'attachment; filename="Concession_Ledger_{date_from}_to_{date_to}.xlsx"'})

    if format == "pdf":
        import io, html as _html
        from xhtml2pdf import pisa
        from fastapi import Response
        trs = "".join(
            f"<tr><td>{i}</td><td>{_html.escape((r.get('student') or {}).get('name','-'))}</td>"
            f"<td>{_html.escape((r.get('student') or {}).get('admission_no','-'))}</td>"
            f"<td>{_html.escape((r.get('adjustment_type','-') or '-').replace('_',' '))}</td>"
            f"<td>{_html.escape(r.get('reason','') or '')}</td>"
            f"<td class='r'>Rs. {r.get('amount',0):,.2f}</td>"
            f"<td>{_html.escape(r.get('approved_by_name','') or '')}</td>"
            f"<td>{_html.escape((r.get('approved_at') or '')[:10])}</td></tr>"
            for i, r in enumerate(rows, 1)
        )
        html_str = f"""<html><head><style>
          @page {{ size: A4 landscape; margin: 10mm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; font-size: 9px; }}
          h1 {{ font-size: 16px; text-align:center; margin: 0; }}
          .sub {{ text-align:center; font-size: 10px; color:#444; margin: 2px 0 10px; }}
          table {{ width: 100%; border-collapse: collapse; }}
          th {{ background:#1E293B; color:#fff; padding:4px; text-align:left; font-size: 9px; }}
          td {{ padding:3px 4px; border-bottom:0.5px solid #ccc; }}
          td.r {{ text-align:right; }}
        </style></head><body>
        <h1>BALAJI CONVENT &amp; JUNIOR COLLEGE</h1>
        <div class="sub">Concession &amp; Adjustment Ledger &middot; {date_from} &rarr; {date_to} &middot; {len(rows)} records &middot; Total Rs. {total:,.2f}</div>
        <table>
        <thead><tr><th>#</th><th>Student</th><th>Adm No</th><th>Type</th><th>Reason</th><th>Amount</th><th>Approved By</th><th>Date</th></tr></thead>
        <tbody>{trs}</tbody></table></body></html>"""
        buf = io.BytesIO()
        pisa.CreatePDF(html_str, dest=buf)
        return Response(content=buf.getvalue(), media_type="application/pdf",
                         headers={"Content-Disposition": f'inline; filename="Concession_Ledger_{date_from}_to_{date_to}.pdf"'})

    raise HTTPException(400, f"Unknown format '{format}' - use json, csv, xlsx, or pdf")

@router.get("/reports/defaulters")
async def defaulters_report(
    quarter: Literal["Q1","Q2","Q3","total"] = "total",
    department_id: Optional[str] = None,
    class_id: Optional[str] = None,
    user = Depends(get_current_user),
):
    q: Dict[str, Any] = {"status": "active", "fee_structure_id": {"$ne": None}}
    if department_id: q["department_id"] = department_id
    if class_id: q["class_id"] = class_id
    students = await db.students.find(q, {"_id": 0}).to_list(5000)
    if not students:
        return {"count": 0, "total_outstanding": 0, "students": [], "quarter": quarter}
    dept_map = {d["id"]: d for d in await db.departments.find({}, {"_id":0}).to_list(50)}
    class_map = {c["id"]: c for c in await db.classes.find({}, {"_id":0}).to_list(500)}
    fs_ids = list({s.get("fee_structure_id") for s in students if s.get("fee_structure_id")})
    fs_map = {f["id"]: f for f in await db.fee_structures.find({"id": {"$in": fs_ids}}, {"_id":0}).to_list(500)}
    sids = [s["id"] for s in students]
    receipts = await db.receipts.find({"student_id": {"$in": sids}, "status": {"$ne":"cancelled"}, "receipt_type": {"$in":["school","admission"]}}, {"_id":0}).to_list(20000)
    paid_q: Dict[str, Dict[str, float]] = {}
    for r in receipts:
        for line in r.get("lines", []):
            nm = (line.get("fee_head_name") or "").lower()
            for tag in ("q1","q2","q3"):
                if tag in nm:
                    paid_q.setdefault(r["student_id"], {}).setdefault(tag.upper(), 0)
                    paid_q[r["student_id"]][tag.upper()] += float(line.get("amount", 0))
    total_paid: Dict[str, float] = {}
    for r in receipts:
        if r.get("receipt_type") in ("refund","debit_voucher"): continue
        total_paid[r["student_id"]] = total_paid.get(r["student_id"], 0) + r.get("total", 0)
    rows = []
    for s in students:
        fs = fs_map.get(s["fee_structure_id"])
        if not fs: continue
        if quarter in ("Q1","Q2","Q3"):
            qamt = sum(float(it.get("amount", 0)) for it in fs.get("items", []) if quarter.lower() in (it.get("fee_head_name","") or "").lower())
            paid = paid_q.get(s["id"], {}).get(quarter, 0)
            outstanding = qamt - paid
        else:
            qamt = fs.get("total", 0)
            paid = total_paid.get(s["id"], 0)
            outstanding = qamt - paid
        if outstanding <= 0: continue
        rows.append({
            "student_id": s["id"], "admission_no": s["admission_no"], "name": s["name"],
            "guardian_name": s.get("guardian_name"), "guardian_mobile": s.get("guardian_mobile"),
            "department_name": dept_map.get(s["department_id"],{}).get("name"),
            "class_name": class_map.get(s["class_id"],{}).get("name"),
            "fee": qamt, "paid": paid, "outstanding": outstanding,
        })
    rows.sort(key=lambda x: (-x["outstanding"]))
    return {"count": len(rows), "total_outstanding": sum(x["outstanding"] for x in rows), "students": rows, "quarter": quarter}

@router.get("/reports/day-end")
async def day_end_report(
    date: Optional[str] = None,
    cashier_id: Optional[str] = None,
    user = Depends(get_current_user),
):
    from datetime import datetime as _dt, timezone as _tz
    day = date or _dt.now(_tz.utc).date().isoformat()
    q: Dict[str, Any] = {"created_at": {"$gte": day + "T00:00:00", "$lte": day + "T23:59:59.999999"}}
    role = user.get("role")
    if role == "cashier":
        cashier_id = user["id"]
    if cashier_id:
        q["cashier_id"] = cashier_id
    receipts = await db.receipts.find(q, {"_id":0}).sort("created_at", 1).to_list(5000)

    def agg_of(rs):
        by_mode: Dict[str, float] = {}
        by_type: Dict[str, float] = {}
        collected = refunded = 0.0
        issued = cancelled = 0
        for r in rs:
            total = float(r.get("total", 0) or 0)
            mode = (r.get("payment_mode") or "other").lower()
            rt = r.get("receipt_type") or "school"
            if r.get("status") == "cancelled":
                cancelled += 1
                continue
            issued += 1
            if rt in ("refund","debit_voucher"):
                refunded += total
            else:
                collected += total
            by_mode[mode] = by_mode.get(mode, 0) + total
            by_type[rt] = by_type.get(rt, 0) + total
        return {
            "collected": round(collected, 2), "refunded": round(refunded, 2),
            "net": round(collected - refunded, 2), "issued": issued, "cancelled": cancelled,
            "by_mode": [{"mode": k, "amount": round(v,2)} for k, v in sorted(by_mode.items(), key=lambda x: -x[1])],
            "by_type": [{"type": k, "amount": round(v,2)} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
        }

    payload: Dict[str, Any] = {"date": day, "generated_at": now_iso(), "generated_by": user["name"]}
    if cashier_id:
        cashier = await db.users.find_one({"id": cashier_id}, {"_id":0, "password_hash":0, "pin_hash":0}) or {"name": "Unknown"}
        payload["cashier"] = {"id": cashier_id, "name": cashier.get("name"), "role": cashier.get("role")}
        payload.update(agg_of(receipts))
        payload["receipts"] = [
            {"number": r.get("number"), "receipt_type": r.get("receipt_type"), "payer_name": r.get("payer_name"),
             "payment_mode": r.get("payment_mode"), "total": r.get("total"), "status": r.get("status"),
             "created_at": r.get("created_at"), "department_code": r.get("department_code")}
            for r in receipts
        ]
    else:
        by_cashier: Dict[str, List[dict]] = {}
        for r in receipts:
            by_cashier.setdefault(r.get("cashier_id","unknown"), []).append(r)
        cashiers = []
        for cid, rs in by_cashier.items():
            u = await db.users.find_one({"id": cid}, {"_id":0, "password_hash":0, "pin_hash":0}) or {"name": rs[0].get("cashier_name","Unknown")}
            item = {"id": cid, "name": u.get("name"), "role": u.get("role"), **agg_of(rs)}
            cashiers.append(item)
        cashiers.sort(key=lambda x: -x["net"])
        payload["cashiers"] = cashiers
        payload.update(agg_of(receipts))
    return payload

# ---------- Bus Routes ----------
@router.get("/bus-stops")
async def list_bus_stops(user = Depends(get_current_user)):
    """Master list of every bus stop the school picks up from — one row per receipt-visible stop."""
    return await db.bus_stops.find({}, {"_id":0}).sort("stop_no", 1).to_list(500)


@router.get("/bus-fee-update/hierarchy")
async def bus_fee_update_hierarchy(academic_year: str = "2026-27", user = Depends(get_current_user)):
    """Main Area -> Sub Stop -> active students, with each student's CURRENT
    effective monthly fee (their own active bus_assignments row if one
    exists, else the stop's standard rate) - for the Live Bus Fee Update
    screen (Phase 5). Read-only; 'Updated Monthly Fee' stays blank until the
    admin explicitly submits a change via PATCH /bus-stops/{id} (stop-wide)
    or POST /students/{id}/bus-assignment with monthly_fee_override (individual)."""
    stops = await db.bus_stops.find({"academic_year": academic_year, "active": {"$ne": False}}, {"_id": 0}).sort("stop_no", 1).to_list(500)
    students = await db.students.find({"status": "active", "bus_required": True}, {"_id": 0}).to_list(5000)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    by_stop_no: Dict[int, list] = {}
    for s in students:
        by_stop_no.setdefault(s.get("bus_stop_no"), []).append(s)

    areas: Dict[str, list] = {}
    for stop in stops:
        assigned = by_stop_no.get(stop["stop_no"], [])
        stop_students = []
        for s in assigned:
            assignment = await db.bus_assignments.find_one({"student_id": s["id"], "status": "active"}, {"_id": 0})
            current_fee = assignment.get("monthly_fee") if assignment else stop.get("monthly_fee")
            cls = classes.get(s.get("class_id"), {})
            stop_students.append({
                "student_id": s["id"], "admission_no": s.get("admission_no"), "student_name": s.get("name"),
                "class_name": cls.get("name"), "medium": s.get("medium"), "current_monthly_fee": current_fee,
            })
        areas.setdefault(stop.get("main_area") or "—", []).append({
            "stop_id": stop["id"], "stop_no": stop["stop_no"], "stop_name": stop.get("stop_name"),
            "monthly_fee": stop.get("monthly_fee"), "active_student_count": len(stop_students), "students": stop_students,
        })
    return [{"main_area": area, "stops": stops_list} for area, stops_list in sorted(areas.items())]

@router.post("/bus-stops/bulk-update")
async def bulk_update_bus_fares(body: Dict[str, Any], user = Depends(require_roles("administrator","manager"))):
    """Bulk raise / lower every stop's monthly fee.
    body = {
      operation: 'increase_percent' | 'decrease_percent' | 'increase_fixed' | 'decrease_fixed',
      value: number,
      stop_ids: [ids?]   (empty = all active),
      round_to: 10        (round the new fare to nearest N, default 10),
      preview: bool,
      effective_date: iso,
      reason: str,
    }
    """
    op = body.get("operation")
    if op not in ("increase_percent","decrease_percent","increase_fixed","decrease_fixed"):
        raise HTTPException(400, "operation must be one of increase_percent/decrease_percent/increase_fixed/decrease_fixed")
    try:
        value = float(body.get("value"))
    except Exception:
        raise HTTPException(400, "value must be a number")
    if value < 0:
        raise HTTPException(400, "value must be positive; use the correct operation for the direction")
    round_to = int(body.get("round_to") or 10) or 1
    stop_ids = body.get("stop_ids") or []
    preview = bool(body.get("preview", True))
    q: Dict[str, Any] = {"active": {"$ne": False}}
    if stop_ids:
        q["id"] = {"$in": stop_ids}
    stops = await db.bus_stops.find(q, {"_id": 0}).sort("stop_no", 1).to_list(500)
    if not stops:
        raise HTTPException(400, "No active stops match the selection")
    # Count students per stop
    student_counts = {}
    for s in stops:
        student_counts[s["stop_no"]] = await db.students.count_documents({"bus_stop_no": s["stop_no"], "status": "active"})

    def new_fare(old: float) -> float:
        if op == "increase_percent": nf = old * (1 + value / 100)
        elif op == "decrease_percent": nf = old * (1 - value / 100)
        elif op == "increase_fixed":   nf = old + value
        else: nf = old - value
        if nf < 0: nf = 0
        return round(nf / round_to) * round_to

    rows = []
    total_current = total_new = total_students = 0
    for s in stops:
        old = float(s.get("monthly_fee") or 0)
        nf = new_fare(old)
        stud = student_counts.get(s["stop_no"], 0)
        rows.append({"id": s["id"], "stop_no": s["stop_no"], "stop_name": s.get("stop_name"),
                     "current_fare": old, "new_fare": nf, "delta": nf - old, "students_affected": stud})
        total_current += old; total_new += nf; total_students += stud

    if preview:
        return {"preview": True, "operation": op, "value": value, "round_to": round_to,
                "rows": rows, "total_current": total_current, "total_new": total_new,
                "total_students_affected": total_students,
                "effective_date": body.get("effective_date"), "reason": body.get("reason","")}

    for r in rows:
        if r["new_fare"] != r["current_fare"]:
            await db.bus_stops.update_one({"id": r["id"]}, {"$set": {"monthly_fee": r["new_fare"], "last_fare_change_at": now_iso(), "last_fare_change_by": user["name"]}})
    await audit(user, "bulk_fare_update", "bus_stop", "", {
        "operation": op, "value": value, "round_to": round_to,
        "stops_changed": len([r for r in rows if r["new_fare"] != r["current_fare"]]),
        "total_current": total_current, "total_new": total_new,
        "students_affected": total_students,
        "effective_date": body.get("effective_date"), "reason": body.get("reason",""),
    })
    return {"preview": False, "applied": True, "rows": rows,
            "stops_changed": len([r for r in rows if r["new_fare"] != r["current_fare"]]),
            "total_current": total_current, "total_new": total_new,
            "total_students_affected": total_students}


@router.post("/bus-stops")
async def create_bus_stop(body: Dict[str, Any], user = Depends(require_roles("administrator","manager","accountant"))):
    try:
        stop_no = int(body.get("stop_no"))
    except Exception:
        raise HTTPException(400, "stop_no must be a number")
    academic_year = body.get("academic_year") or "2026-27"
    if await db.bus_stops.find_one({"stop_no": stop_no, "academic_year": academic_year}):
        raise HTTPException(400, f"Stop no {stop_no} already exists for {academic_year}")
    doc = {
        "id": gen_id(), "stop_no": stop_no,
        "main_area": str(body.get("main_area", "")).strip(),
        "stop_name": str(body.get("stop_name", "")).strip(),
        "monthly_fee": float(body.get("monthly_fee") or 0),
        "academic_year": academic_year,
        "active": True, "created_at": now_iso(),
    }
    if not doc["stop_name"]:
        raise HTTPException(400, "stop_name is required")
    if not doc["main_area"]:
        raise HTTPException(400, "main_area is required")
    await db.bus_stops.insert_one(doc)
    await audit(user, "create", "bus_stop", doc["id"], {"stop_no": stop_no, "main_area": doc["main_area"], "name": doc["stop_name"]})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.patch("/bus-stops/{sid}")
async def update_bus_stop(sid: str, body: Dict[str, Any], user = Depends(require_roles("administrator","manager","accountant"))):
    """Renaming/relabeling a stop, or toggling active, edits in place.
    A monthly_fee change for a DIFFERENT academic_year than the stop's current
    one does NOT mutate this row (that would silently rewrite what every
    already-assigned student appears to have been charged) - it creates a new
    per-year row instead, exactly like fee_structures does. A fee change for
    the SAME academic_year (correcting a typo before anyone's been charged)
    still edits in place."""
    current = await db.bus_stops.find_one({"id": sid})
    if not current:
        raise HTTPException(404, "Bus stop not found")
    allowed = {k: v for k, v in body.items() if k in ("main_area", "stop_name", "monthly_fee", "active", "academic_year")}
    if "monthly_fee" in allowed:
        allowed["monthly_fee"] = float(allowed["monthly_fee"] or 0)

    new_year = allowed.get("academic_year")
    if new_year and new_year != current.get("academic_year") and "monthly_fee" in allowed:
        new_doc = {
            **current, "id": gen_id(),
            "main_area": allowed.get("main_area", current.get("main_area", "")),
            "stop_name": allowed.get("stop_name", current.get("stop_name", "")),
            "monthly_fee": allowed["monthly_fee"],
            "academic_year": new_year,
            "active": allowed.get("active", True),
            "created_at": now_iso(), "created_from_id": sid,
        }
        new_doc.pop("_id", None)
        await db.bus_stops.insert_one(new_doc)
        await audit(user, "create_next_year_fare", "bus_stop", new_doc["id"], {"stop_no": current["stop_no"], "academic_year": new_year, "monthly_fee": allowed["monthly_fee"]})
        return {k: v for k, v in new_doc.items() if k != "_id"}

    r = await db.bus_stops.update_one({"id": sid}, {"$set": allowed})
    if r.matched_count == 0:
        raise HTTPException(404, "Bus stop not found")
    if "monthly_fee" in allowed:
        # Richer audit specifically for a fee change (Phase 7/8) - old/new fee
        # and how many currently-active students at this exact stop are
        # affected going forward. Historical bus_charges rows already store
        # their own amount and are never touched by this.
        affected = await db.students.count_documents({"bus_stop_no": current.get("stop_no"), "status": "active", "bus_required": True})
        await audit(user, "fee_update", "bus_stop", sid, {
            "main_area": current.get("main_area"), "stop_name": current.get("stop_name"), "stop_no": current.get("stop_no"),
            "old_monthly_fee": current.get("monthly_fee"), "new_monthly_fee": allowed["monthly_fee"],
            "affected_student_count": affected, "updated_by": user["name"], "updated_by_id": user["id"],
            "at": now_iso(), "reason": body.get("reason") or "",
        })
    else:
        await audit(user, "update", "bus_stop", sid, allowed)
    return {"ok": True}

@router.delete("/bus-stops/{sid}")
async def delete_bus_stop(sid: str, user = Depends(require_roles("administrator"))):
    doc = await db.bus_stops.find_one({"id": sid})
    if not doc:
        raise HTTPException(404, "Bus stop not found")
    used = await db.students.count_documents({"bus_stop_no": doc.get("stop_no")})
    if used > 0:
        raise HTTPException(409, f"{used} student(s) still assigned to this stop — reassign them first or set the stop to inactive instead.")
    await db.bus_stops.delete_one({"id": sid})
    await audit(user, "delete", "bus_stop", sid, {"stop_no": doc.get("stop_no")})
    return {"deleted": True}

@router.post("/bus-stops/seed-2026")
async def seed_bus_stops(replace: bool = False, user = Depends(require_roles("administrator","manager"))):
    """Seeds the 2026-27 bus stop master list from data/bus_stops_2026.json
    (shipped with the backend - previously this pointed at a Linux-container
    path, /app/memory/..., that never existed on Windows and had no file
    behind it either way, so this endpoint always 404'd).

    IMPORTANT: this file currently holds only the stops the school has
    explicitly confirmed (31 of the reported 64) - see the file's own
    "_note" field. It is NOT invented data; blank/unconfirmed stops are
    simply absent rather than guessed at. Re-run this once the full
    reference sheet is supplied to load the remaining stops."""
    import json as _json
    seed_path = APP_ROOT / "backend" / "data" / "bus_stops_2026.json"
    if not seed_path.exists():
        raise HTTPException(404, f"Seed file not found at {seed_path}")
    with open(seed_path, "r", encoding="utf-8") as f:
        payload = _json.load(f)
    rows = payload["stops"] if isinstance(payload, dict) else payload
    if replace:
        await db.bus_stops.delete_many({"academic_year": "2026-27"})
    created = skipped = 0
    for row in rows:
        if await db.bus_stops.find_one({"stop_no": row["stop_no"], "academic_year": "2026-27"}):
            skipped += 1; continue
        await db.bus_stops.insert_one({
            "id": gen_id(), "stop_no": row["stop_no"], "main_area": row["main_area"],
            "stop_name": row["stop_name"], "monthly_fee": row["monthly_fee"],
            "academic_year": "2026-27", "active": True, "created_at": now_iso(),
        })
        created += 1
    await audit(user, "seed", "bus_stops", "", {"created": created, "skipped": skipped, "replace": replace})
    return {"created": created, "skipped": skipped, "total_rows": len(rows), "replaced": replace}

# ---------- Bus reports (PART 34) ----------
@router.get("/reports/bus/stop-wise")
async def bus_report_stop_wise(user = Depends(get_current_user)):
    """One row per active stop, with the students currently assigned to it."""
    stops = await db.bus_stops.find({"active": {"$ne": False}}, {"_id": 0}).sort([("main_area", 1), ("stop_no", 1)]).to_list(500)
    out = []
    for s in stops:
        students = await db.students.find(
            {"bus_stop_no": s["stop_no"], "status": "active"},
            {"_id": 0, "id": 1, "name": 1, "admission_no": 1},
        ).to_list(1000)
        out.append({**s, "student_count": len(students), "students": students,
                     "monthly_collection": len(students) * s.get("monthly_fee", 0)})
    return out

@router.get("/reports/bus/area-wise")
async def bus_report_area_wise(user = Depends(get_current_user)):
    """Student count + collection per Main Area, summed across its sub stops."""
    stops = await db.bus_stops.find({"active": {"$ne": False}}, {"_id": 0}).to_list(500)
    areas: Dict[str, Dict[str, Any]] = {}
    for s in stops:
        area = s.get("main_area") or "(unspecified)"
        cnt = await db.students.count_documents({"bus_stop_no": s["stop_no"], "status": "active"})
        a = areas.setdefault(area, {"main_area": area, "stop_count": 0, "student_count": 0, "monthly_collection": 0})
        a["stop_count"] += 1
        a["student_count"] += cnt
        a["monthly_collection"] += cnt * s.get("monthly_fee", 0)
    return sorted(areas.values(), key=lambda x: x["main_area"])

@router.get("/reports/bus/without-stop")
async def bus_report_without_stop(user = Depends(get_current_user)):
    """Active students with no bus stop assigned - useful for catching students
    who ride the bus but were never formally assigned a stop."""
    return await db.students.find(
        {"status": "active", "$or": [{"bus_stop_no": None}, {"bus_stop_no": {"$exists": False}}]},
        {"_id": 0, "id": 1, "name": 1, "admission_no": 1, "class_id": 1, "department_id": 1},
    ).to_list(2000)

@router.get("/reports/bus/collection")
async def bus_report_collection(user = Depends(get_current_user)):
    """Expected monthly bus collection - active students x their assigned stop's fee."""
    students = await db.students.find({"status": "active", "bus_stop_no": {"$ne": None}}, {"_id": 0}).to_list(5000)
    stop_fees = {s["stop_no"]: s.get("monthly_fee", 0) for s in await db.bus_stops.find({}, {"_id": 0}).to_list(500)}
    total = sum(stop_fees.get(s.get("bus_stop_no"), 0) for s in students)
    return {"student_count": len(students), "expected_monthly_collection": total}

@router.get("/reports/bus/detailed")
async def bus_report_detailed(
    student: Optional[str] = None, admission_no: Optional[str] = None,
    class_id: Optional[str] = None, medium: Optional[str] = None,
    main_stop: Optional[str] = None, sub_stop: Optional[str] = None,
    academic_year: Optional[str] = None, bus_status: Optional[str] = None,
    format: str = "json",
    user = Depends(get_current_user),
):
    """The dedicated Bus Fee Report — kept entirely separate from the normal school Fee Report.
    One row per student, with their Main Stop / Sub Stop / Monthly Fee and real Amount Paid /
    Outstanding computed from actual bus_charges (never invented). format=json|pdf|xlsx|csv."""
    q: Dict[str, Any] = {}
    if class_id: q["class_id"] = class_id
    if medium: q["medium"] = medium
    if academic_year: q["academic_year"] = academic_year
    # re.escape - see students.py's list_students() for the same fix and rationale:
    # literal search text, never executable regex syntax.
    if admission_no: q["admission_no"] = {"$regex": re.escape(admission_no), "$options": "i"}
    if student: q["name"] = {"$regex": re.escape(student), "$options": "i"}
    if bus_status == "active": q["bus_required"] = True
    elif bus_status == "inactive": q["bus_required"] = {"$ne": True}
    if main_stop: q["bus_main_area"] = main_stop
    if sub_stop: q["bus_stop_name"] = sub_stop

    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(2000)}
    students = await db.students.find(q, {"_id": 0}).sort("name", 1).to_list(5000)
    student_ids = [s["id"] for s in students]
    charges = await db.bus_charges.find({"student_id": {"$in": student_ids}}, {"_id": 0}).to_list(20000)
    by_student: Dict[str, List[dict]] = {}
    for c in charges:
        by_student.setdefault(c["student_id"], []).append(c)
    active_assignments = await db.bus_assignments.find(
        {"student_id": {"$in": student_ids}, "status": "active"}, {"_id": 0}
    ).to_list(5000)
    assignment_by_student = {a["student_id"]: a for a in active_assignments}

    rows = []
    for s in students:
        cls = classes.get(s.get("class_id"), {})
        cc = by_student.get(s["id"], [])
        paid = sum(c.get("amount_paid", 0) for c in cc)
        outstanding = sum(max(0, c.get("amount", 0) - c.get("amount_paid", 0)) for c in cc if c.get("status") != "paid")
        # Monthly fee comes from the student's ACTIVE assignment record (the fee captured at
        # assignment time), not a live re-lookup against bus_stops - a later fare change on the
        # master stop must never silently rewrite what a student is shown to owe historically.
        assignment = assignment_by_student.get(s["id"])
        rows.append({
            "student_name": s["name"], "admission_no": s["admission_no"],
            "class_name": cls.get("name", ""), "medium": s.get("medium", ""),
            "main_stop": (assignment or {}).get("main_area") or s.get("bus_main_area") or "",
            "sub_stop": (assignment or {}).get("stop_name") or s.get("bus_stop_name") or "",
            "monthly_bus_fee": (assignment or {}).get("monthly_fee") or 0,
            "amount_paid": paid, "outstanding_balance": outstanding,
            "bus_status": "Active" if s.get("bus_required") else "Inactive",
        })

    if format == "json":
        return rows

    if format == "csv":
        import io, csv as _csv
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["Student Name","Admission No.","Class","Medium","Main Stop","Sub Stop","Monthly Bus Fee","Amount Paid","Outstanding Balance","Bus Status"])
        for r in rows:
            w.writerow([r["student_name"], r["admission_no"], r["class_name"], r["medium"], r["main_stop"],
                        r["sub_stop"], r["monthly_bus_fee"], r["amount_paid"], r["outstanding_balance"], r["bus_status"]])
        from fastapi import Response
        return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                         headers={"Content-Disposition": 'attachment; filename="Bus_Fee_Report.csv"'})

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        from fastapi import Response
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Bus Fee Report"
        headers = ["Student Name","Admission No.","Class","Medium","Main Stop","Sub Stop","Monthly Bus Fee","Amount Paid","Outstanding Balance","Bus Status"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E40AF")
        for r in rows:
            ws.append([r["student_name"], r["admission_no"], r["class_name"], r["medium"], r["main_stop"],
                       r["sub_stop"], r["monthly_bus_fee"], r["amount_paid"], r["outstanding_balance"], r["bus_status"]])
        for idx, w in enumerate([24,14,10,20,20,30,14,12,16,10], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": 'attachment; filename="Bus_Fee_Report.xlsx"'})

    if format == "pdf":
        import io, html as _html
        from xhtml2pdf import pisa
        from fastapi import Response
        trs = "".join(
            f"<tr><td>{_html.escape(r['student_name'])}</td><td>{_html.escape(r['admission_no'])}</td>"
            f"<td>{_html.escape(r['class_name'])}</td><td>{_html.escape(r['medium'])}</td>"
            f"<td>{_html.escape(r['main_stop'])}</td><td>{_html.escape(r['sub_stop'])}</td>"
            f"<td class='r'>Rs. {r['monthly_bus_fee']:,.0f}</td><td class='r'>Rs. {r['amount_paid']:,.0f}</td>"
            f"<td class='r'>Rs. {r['outstanding_balance']:,.0f}</td><td>{r['bus_status']}</td></tr>"
            for r in rows
        )
        html_str = f"""<html><head><style>
          @page {{ size: A4 landscape; margin: 10mm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; font-size: 7.5px; }}
          h1 {{ font-size: 15px; margin: 0 0 4px 0; }}
          p {{ margin: 0 0 6px 0; }}
          table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
          th {{ background:#1E40AF; color:#fff; padding:3px; text-align:left; font-size: 7.5px; }}
          td {{ padding:2px 3px; border-bottom:0.5px solid #ccc; word-wrap: break-word; overflow-wrap: break-word; }}
          td.r {{ text-align:right; }}
        </style></head><body>
        <h1>Balaji Convent &amp; Junior College - Bus Fee Report</h1>
        <p>{len(rows)} students</p>
        <table>
        <colgroup>
          <col style="width:16%"/><col style="width:9%"/><col style="width:7%"/><col style="width:10%"/>
          <col style="width:13%"/><col style="width:17%"/><col style="width:9%"/><col style="width:8%"/>
          <col style="width:9%"/><col style="width:7%"/>
        </colgroup>
        <thead><tr><th>Student</th><th>Admission No.</th><th>Class</th><th>Medium</th><th>Main Stop</th>
        <th>Sub Stop</th><th>Monthly Fee</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
        <tbody>{trs}</tbody></table></body></html>"""
        buf = io.BytesIO()
        pisa.CreatePDF(html_str, dest=buf)
        return Response(content=buf.getvalue(), media_type="application/pdf",
                         headers={"Content-Disposition": 'inline; filename="Bus_Fee_Report.pdf"'})

    raise HTTPException(400, f"Unknown format '{format}' - use json, csv, xlsx, or pdf")

@router.get("/bus-routes")
async def list_bus_routes(user = Depends(get_current_user)):
    return await db.bus_routes.find({}, {"_id":0}).sort("name", 1).to_list(200)

@router.post("/bus-routes")
async def create_bus_route(body: BusRouteIn, user = Depends(require_roles("administrator","manager","accountant"))):
    if await db.bus_routes.find_one({"code": body.code}):
        raise HTTPException(400, "Route code already exists")
    rid = gen_id()
    doc = {"id": rid, **body.model_dump(), "created_at": now_iso()}
    await db.bus_routes.insert_one(doc)
    await audit(user, "create", "bus_route", rid, {"code": body.code})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.patch("/bus-routes/{rid}")
async def update_bus_route(rid: str, body: Dict[str, Any], user = Depends(require_roles("administrator","manager","accountant"))):
    allowed = {k: v for k, v in body.items() if k in ("name","driver_name","driver_mobile","vehicle_no","monthly_fee","stops","active")}
    await db.bus_routes.update_one({"id": rid}, {"$set": allowed})
    await audit(user, "update", "bus_route", rid, allowed)
    return {"ok": True}

@router.get("/bus-routes/{rid}/roster")
async def bus_route_roster(rid: str, month: Optional[str] = None, user = Depends(get_current_user)):
    route = await db.bus_routes.find_one({"id": rid}, {"_id":0})
    if not route: raise HTTPException(404, "Route not found")
    students = await db.students.find({"bus_route": route["code"], "status":"active"}, {"_id":0}).to_list(2000)
    m = month or date.today().isoformat()[:7]
    sids = [s["id"] for s in students]
    receipts = await db.receipts.find({
        "receipt_type": "bus", "student_id": {"$in": sids}, "status": {"$ne":"cancelled"},
        "created_at": {"$gte": m + "-01", "$lte": m + "-31T23:59:59"},
    }, {"_id":0}).to_list(5000)
    paid_by = {}
    for r in receipts:
        paid_by[r["student_id"]] = paid_by.get(r["student_id"], 0) + r.get("total", 0)
    roster = []
    for s in students:
        roster.append({
            "student_id": s["id"], "admission_no": s["admission_no"], "name": s["name"],
            "class_id": s.get("class_id"), "guardian_mobile": s.get("guardian_mobile"),
            "paid_this_month": paid_by.get(s["id"], 0),
            "status": "paid" if paid_by.get(s["id"], 0) >= route.get("monthly_fee", 0) and route.get("monthly_fee", 0) > 0 else "pending",
        })
    collected = sum(paid_by.values())
    return {"route": route, "month": m, "students_count": len(students), "collected": collected, "expected": route.get("monthly_fee",0) * len(students), "roster": roster}

# ---------- Outstanding Notices ----------
@router.get("/notices/outstanding")
async def outstanding_notices(
    department_id: Optional[str] = None, class_id: Optional[str] = None,
    min_amount: float = 1,
    user = Depends(get_current_user),
):
    q: Dict[str, Any] = {"status":"active"}
    if department_id: q["department_id"] = department_id
    if class_id: q["class_id"] = class_id
    students = await db.students.find(q, {"_id":0}).to_list(5000)
    if not students:
        return {"count": 0, "students": []}
    dept_map = {d["id"]: d for d in await db.departments.find({}, {"_id":0}).to_list(50)}
    class_map = {c["id"]: c for c in await db.classes.find({}, {"_id":0}).to_list(500)}
    fs_ids = list({s.get("fee_structure_id") for s in students if s.get("fee_structure_id")})
    fs_map = {f["id"]: f for f in await db.fee_structures.find({"id":{"$in": fs_ids}}, {"_id":0}).to_list(500)} if fs_ids else {}
    sids = [s["id"] for s in students]
    receipts = await db.receipts.find({"student_id":{"$in": sids}, "status":{"$ne":"cancelled"}}, {"_id":0}).to_list(20000)
    adjs = await db.adjustments.find({"student_id":{"$in": sids}, "status":"approved"}, {"_id":0}).to_list(5000)
    paid_by: Dict[str,float] = {}; refund_by: Dict[str,float] = {}; adj_by: Dict[str,float] = {}
    for r in receipts:
        if r.get("receipt_type") in ("refund",):
            refund_by[r["student_id"]] = refund_by.get(r["student_id"],0) + r.get("total",0)
        # "bus" receipts are excluded here: bus fee is tracked separately via
        # bus_charges/BusFees, not folded into this academic-fee outstanding total.
        elif r.get("receipt_type") in ("school","admission","misc","department","general_money","general_collection"):
            paid_by[r["student_id"]] = paid_by.get(r["student_id"],0) + r.get("total",0)
    for a in adjs:
        adj_by[a["student_id"]] = adj_by.get(a["student_id"],0) + a.get("amount",0)
    out = []
    for s in students:
        fs = fs_map.get(s.get("fee_structure_id"))
        academic_fee = fs.get("total", 0) if fs else 0
        total_fee = academic_fee
        paid = paid_by.get(s["id"], 0); refund = refund_by.get(s["id"], 0); adjusted = adj_by.get(s["id"], 0)
        outstanding = max(0, total_fee - paid - adjusted + refund)
        if outstanding < min_amount: continue
        out.append({
            "student_id": s["id"], "admission_no": s["admission_no"], "name": s["name"],
            "guardian_name": s.get("guardian_name"), "guardian_mobile": s.get("guardian_mobile"),
            "department_name": dept_map.get(s["department_id"],{}).get("name"),
            "class_name": class_map.get(s["class_id"],{}).get("name"),
            "academic_year": dept_map.get(s["department_id"],{}).get("academic_year"),
            "total_fee": total_fee, "academic_fee": academic_fee,
            "paid": paid, "adjusted": adjusted, "refunded": refund,
            "outstanding": outstanding,
            "items": fs.get("items", []) if fs else [],
        })
    out.sort(key=lambda x: (-x["outstanding"]))
    return {"count": len(out), "students": out}

# ---------- Quarterly Reminders (cron + manual) ----------
@router.post("/cron/quarterly-reminders")
async def cron_quarterly_reminders(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing auth")
    expected = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not expected or not hmac.compare_digest(auth[7:], expected):
        raise HTTPException(401, "Invalid cron secret")
    asyncio.create_task(_generate_quarterly_reminders())
    return {"accepted": True}

@router.post("/reminders/generate-quarterly")
async def manual_generate_quarterly(user = Depends(require_roles("administrator","manager","accountant"))):
    result = await _generate_quarterly_reminders()
    await audit(user, "generate_quarterly_reminders", "reminder", "", result)
    return result

# ---------- Public (no auth) ----------
@router.get("/public/student-lookup/{admission_no}")
async def public_student_lookup(admission_no: str):
    s = await db.students.find_one({"admission_no": admission_no}, {"_id": 0})
    if not s: raise HTTPException(404, "Student not found")
    guardian_mobile = s.get("guardian_mobile")
    siblings_query = {"status": "active"}
    if guardian_mobile:
        siblings_query["guardian_mobile"] = guardian_mobile
    else:
        siblings_query["id"] = s["id"]
    all_students = await db.students.find(siblings_query, {"_id": 0}).to_list(20)

    async def _ledger(stu):
        receipts = await db.receipts.find({"student_id": stu["id"], "status": {"$ne": "cancelled"}},
                                          {"_id": 0, "cashier_id": 0}).sort("created_at", -1).to_list(200)
        fs = None
        if stu.get("fee_structure_id"):
            fs = await db.fee_structures.find_one({"id": stu["fee_structure_id"]}, {"_id": 0})
        # school fee only — total_fee here is fs.total (school fee structure),
        # so a Bus receipt's total must not count as "paid" against it, or the
        # displayed outstanding drops by the bus amount with no school fee paid.
        paid = sum(x.get("total", 0) for x in receipts if x.get("receipt_type") not in ("refund","debit_voucher","bus"))
        # Same opening-paid carry-forward as /students/{id}/ledger — a real
        # pre-go-live payment imported into fee_details, never a fake receipt —
        # so a parent checking their own balance here sees the same figure
        # staff see on the Fee Update screen, not a stale ₹0.
        fd = await db.fee_details.find_one(
            {"student_id": stu["id"], "academic_year": stu.get("academic_year") or "2026-27"}, {"_id": 0}
        )
        paid += float(fd.get("total_paid") or 0) if fd else 0
        refunded = sum(x.get("total", 0) for x in receipts if x.get("receipt_type") == "refund")
        adjustments = await db.adjustments.find({"student_id": stu["id"], "status": "approved"}, {"_id": 0}).to_list(100)
        adjusted = sum(a.get("amount", 0) for a in adjustments)
        total_fee = fs.get("total", 0) if fs else 0
        return {
            "student": {"admission_no": stu["admission_no"], "name": stu["name"], "guardian_name": stu.get("guardian_name"), "guardian_mobile": stu.get("guardian_mobile")},
            "ledger": {
                "total_fee": total_fee, "paid": paid, "adjusted": adjusted, "refunded": refunded,
                "outstanding": max(0, total_fee - paid - adjusted + refunded),
                "receipts": [{"number": x["number"], "type": x.get("receipt_type"), "date": x.get("created_at"), "total": x.get("total"), "mode": x.get("payment_mode")} for x in receipts[:10]],
                "receipts_count": len(receipts),
            }
        }

    children = [await _ledger(x) for x in all_students]
    combined = {
        "total_fee": sum(c["ledger"]["total_fee"] for c in children),
        "paid": sum(c["ledger"]["paid"] for c in children),
        "adjusted": sum(c["ledger"]["adjusted"] for c in children),
        "refunded": sum(c["ledger"]["refunded"] for c in children),
        "outstanding": sum(c["ledger"]["outstanding"] for c in children),
    }
    return {"guardian_mobile": guardian_mobile, "children": children, "combined": combined}

@router.get("/public/lookup/{number}")
async def public_lookup(number: str):
    r = await db.receipts.find_one({"number": number}, {"_id": 0, "cashier_id": 0})
    if not r:
        raise HTTPException(404, "Receipt not found")
    payload: Dict[str, Any] = {"receipt": r}
    if r.get("student_id"):
        s = await db.students.find_one({"id": r["student_id"]}, {"_id": 0})
        if s:
            payload["student"] = {
                "admission_no": s["admission_no"], "name": s["name"],
                "guardian_name": s.get("guardian_name"), "guardian_mobile": s.get("guardian_mobile"),
                "department_id": s.get("department_id"), "class_id": s.get("class_id"),
            }
            receipts = await db.receipts.find({"student_id": s["id"], "status": {"$ne": "cancelled"}},
                                              {"_id": 0, "cashier_id": 0}).sort("created_at", -1).to_list(200)
            fs = None
            if s.get("fee_structure_id"):
                fs = await db.fee_structures.find_one({"id": s["fee_structure_id"]}, {"_id": 0})
            # school fee only + opening-paid carry-forward — see same fix/comment in public_student_lookup above.
            paid = sum(x.get("total", 0) for x in receipts if x.get("receipt_type") not in ("refund","debit_voucher","bus"))
            fd = await db.fee_details.find_one(
                {"student_id": s["id"], "academic_year": s.get("academic_year") or "2026-27"}, {"_id": 0}
            )
            paid += float(fd.get("total_paid") or 0) if fd else 0
            refunded = sum(x.get("total", 0) for x in receipts if x.get("receipt_type") == "refund")
            adjustments = await db.adjustments.find({"student_id": s["id"], "status": "approved"}, {"_id": 0}).to_list(100)
            adjusted = sum(a.get("amount", 0) for a in adjustments)
            total_fee = fs.get("total", 0) if fs else 0
            payload["ledger"] = {
                "total_fee": total_fee, "paid": paid, "adjusted": adjusted, "refunded": refunded,
                "outstanding": max(0, total_fee - paid - adjusted + refunded),
                "receipts": [{"number": x["number"], "type": x.get("receipt_type"), "date": x.get("created_at"), "total": x.get("total"), "mode": x.get("payment_mode")} for x in receipts[:20]],
                "receipts_count": len(receipts),
            }
    return payload

# ---------- Student Fee Balance Report ----------
@router.get("/reports/student-fee-balance")
async def student_fee_balance_report(
    academic_year: str = "2026-27",
    class_id: Optional[str] = None,
    section: Optional[str] = None,
    medium: Optional[str] = None,
    stream: Optional[str] = None,
    format: str = "json",
    user = Depends(get_current_user),
):
    """Student-wise SCHOOL fee pending for a class/group, reusing the exact
    same computation the Live Fee Update grid already uses and trusts
    (fee_update_students -> compute_fee_items/apply_opening_paid) - never a
    second, independently-derived total that could drift from it. Bus Fee is
    intentionally excluded here (tracked separately everywhere else in this
    app to avoid the double-counting this software's very first fix in this
    engagement addressed), matching "overall_balance" on Live Fee Update."""
    from routers.fee_details import fee_update_students
    rows = await fee_update_students(academic_year, class_id, section, medium, stream, None, "", user)
    students = [
        {"admission_no": r["admission_no"], "student_name": r["student_name"],
         "class_name": r["class_name"], "medium": r["medium"], "stream": r.get("stream"),
         "pending": round(r.get("overall_balance", 0), 2)}
        for r in rows if round(r.get("overall_balance", 0), 2) > 0
    ]
    students.sort(key=lambda r: r["student_name"] or "")
    total = round(sum(s["pending"] for s in students), 2)

    class_doc = await db.classes.find_one({"id": class_id}, {"_id": 0}) if class_id else None
    group_label = class_doc.get("name") if class_doc else "All Classes"
    if medium: group_label += f" · {medium}"
    if stream: group_label += f" · {stream}"
    if section: group_label += f" · Sec {section}"

    if format == "json":
        return {"group": group_label, "academic_year": academic_year, "rows": students, "total": total, "count": len(students)}

    school = await get_settings_doc()

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        from fastapi import Response
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Fee Balance"
        ws.append([(school.get("school_name") or "BALAJI CONVENT").upper()])
        ws.append([group_label])
        ws.append(["STUDENT FEE BALANCE REPORT", f"Academic Year {academic_year}"])
        ws.append([])
        header_row = ws.max_row + 1
        ws.append(["S.No.", "Student Name", "Total Fee Pending"])
        for cell in ws[header_row]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for i, s in enumerate(students, 1):
            ws.append([i, s["student_name"], s["pending"]])
        ws.append(["", "TOTAL", total])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True)
        ws.column_dimensions["A"].width = 8
        ws.column_dimensions["B"].width = 30
        ws.column_dimensions["C"].width = 18
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": f'attachment; filename="Student_Fee_Balance_{group_label.replace(" ", "_").replace("·","-")}.xlsx"'})

    if format == "pdf":
        import io, html as _html
        from xhtml2pdf import pisa
        from fastapi import Response
        trs = "".join(
            f"<tr><td>{i}</td><td>{_html.escape(s['student_name'] or '')}</td><td class='r'>Rs. {s['pending']:,.2f}</td></tr>"
            for i, s in enumerate(students, 1)
        )
        html_str = f"""<html><head><style>
          @page {{ size: A4 portrait; margin: 14mm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10px; }}
          h1 {{ font-size: 14px; text-align:center; margin: 0; }}
          h2 {{ font-size: 12px; text-align:center; margin: 3px 0; }}
          .sub {{ text-align:center; font-size: 9px; color:#444; margin: 1px 0 10px; }}
          table {{ width: 100%; border-collapse: collapse; }}
          th {{ background:#1E293B; color:#fff; padding:5px; text-align:left; font-size: 10px; }}
          td {{ padding:4px 5px; border-bottom:0.5px solid #ccc; }}
          td.r {{ text-align:right; }}
          tfoot td {{ font-weight:bold; border-top: 1.5px solid #222; }}
        </style></head><body>
        <h1>{_html.escape((school.get('school_name') or 'BALAJI CONVENT').upper())}</h1>
        <h2>{_html.escape(group_label)}</h2>
        <div class="sub">STUDENT FEE BALANCE REPORT &middot; Academic Year {academic_year} &middot; {len(students)} students</div>
        <table>
        <thead><tr><th style="width:40px">S.No.</th><th>Student Name</th><th style="width:120px" class="r">Total Fee Pending</th></tr></thead>
        <tbody>{trs}</tbody>
        <tfoot><tr><td></td><td>TOTAL</td><td class="r">Rs. {total:,.2f}</td></tr></tfoot>
        </table></body></html>"""
        buf = io.BytesIO()
        pisa.CreatePDF(html_str, dest=buf)
        return Response(content=buf.getvalue(), media_type="application/pdf",
                         headers={"Content-Disposition": f'inline; filename="Student_Fee_Balance.pdf"'})

    raise HTTPException(400, f"Unknown format '{format}' - use json, xlsx, or pdf")

# ---------- Fee Edit History (audit) Report ----------
@router.get("/reports/fee-edit-history")
async def fee_edit_history_report(
    student_name: Optional[str] = None,
    admission_no: Optional[str] = None,
    class_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    edited_by: Optional[str] = None,
    fee_type: Optional[str] = None,  # "school" | "bus"
    format: str = "json",
    user = Depends(require_roles("administrator", "manager")),
):
    """Who changed a student's fee, when, what changed, and why - built
    entirely from the existing audit_log entries the fee-update endpoint has
    always written (action='fee_update', entity='student_fee_override');
    never a fabricated/reconstructed history. Restricted to
    administrator/manager - this is fee-edit audit data, not something every
    role should be able to browse."""
    q: Dict[str, Any] = {"action": "fee_update", "entity": "student_fee_override"}
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to + "T23:59:59"
        q["timestamp"] = rng
    if edited_by:
        q["user_email"] = {"$regex": re.escape(edited_by), "$options": "i"}
    rows = await db.audit_log.find(q, {"_id": 0}).sort("timestamp", -1).to_list(5000)

    def _match(r):
        d = r.get("details") or {}
        if student_name and student_name.strip().lower() not in (d.get("student_name") or "").lower():
            return False
        if admission_no and admission_no.strip().lower() not in (d.get("admission_no") or "").lower():
            return False
        if class_name and class_name.strip().lower() not in (d.get("class_name") or "").lower():
            return False
        if fee_type:
            is_bus = (d.get("fee_head_name") or "").strip().lower() == "bus fee"
            if fee_type == "bus" and not is_bus:
                return False
            if fee_type == "school" and is_bus:
                return False
        return True

    filtered = [r for r in rows if _match(r)]
    entries = [{
        "timestamp": r.get("timestamp"), "student_name": (r.get("details") or {}).get("student_name"),
        "admission_no": (r.get("details") or {}).get("admission_no"), "class_name": (r.get("details") or {}).get("class_name"),
        "edited_by": r.get("user_email") or (r.get("details") or {}).get("updated_by"),
        "old_fee": (r.get("details") or {}).get("old_fee"), "new_fee": (r.get("details") or {}).get("new_fee"),
        "difference": (r.get("details") or {}).get("difference"), "reason": (r.get("details") or {}).get("reason"),
        "fee_head_name": (r.get("details") or {}).get("fee_head_name"),
        "via_temporary_access": (r.get("details") or {}).get("via_temporary_access"),
    } for r in filtered]

    if format == "json":
        return {"rows": entries, "count": len(entries)}

    school = await get_settings_doc()

    if format == "xlsx":
        import io, openpyxl
        from openpyxl.styles import Font, PatternFill
        from fastapi import Response
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Fee Edit History"
        headers = ["Date/Time", "Student", "Admission No.", "Class", "Edited By", "Previous Fee", "New Fee", "Difference", "Reason"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1E293B")
        for e in entries:
            ws.append([e["timestamp"], e["student_name"], e["admission_no"], e["class_name"], e["edited_by"],
                       e["old_fee"], e["new_fee"], e["difference"], e["reason"]])
        for idx, w in enumerate([20, 22, 14, 12, 22, 12, 12, 12, 34], start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = w
        buf = io.BytesIO(); wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         headers={"Content-Disposition": 'attachment; filename="Fee_Edit_History.xlsx"'})

    if format == "pdf":
        import io, html as _html
        from xhtml2pdf import pisa
        from fastapi import Response
        def _money_or_dash(v):
            return "-" if v is None else f"Rs. {v:,.2f}"
        trs = "".join(
            f"<tr><td>{_html.escape((e['timestamp'] or '')[:16].replace('T',' '))}</td>"
            f"<td>{_html.escape(e['student_name'] or '-')}</td><td>{_html.escape(e['admission_no'] or '-')}</td>"
            f"<td>{_html.escape(e['class_name'] or '-')}</td><td>{_html.escape(e['edited_by'] or '-')}</td>"
            f"<td class='r'>{_money_or_dash(e['old_fee'])}</td>"
            f"<td class='r'>{_money_or_dash(e['new_fee'])}</td>"
            f"<td class='r'>{_money_or_dash(e['difference'])}</td>"
            f"<td>{_html.escape(e['reason'] or '-')}</td></tr>"
            for e in entries
        )
        html_str = f"""<html><head><style>
          @page {{ size: A4 landscape; margin: 10mm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; }}
          h1 {{ font-size: 14px; text-align:center; margin: 0; }}
          .sub {{ text-align:center; font-size: 9px; color:#444; margin: 2px 0 8px; }}
          table {{ width: 100%; border-collapse: collapse; }}
          th {{ background:#1E293B; color:#fff; padding:4px; text-align:left; font-size: 8.5px; }}
          td {{ padding:3px 4px; border-bottom:0.5px solid #ccc; }}
          td.r {{ text-align:right; }}
        </style></head><body>
        <h1>{_html.escape((school.get('school_name') or 'BALAJI CONVENT').upper())}</h1>
        <div class="sub">FEE EDIT HISTORY &middot; {len(entries)} records</div>
        <table>
        <thead><tr><th>Date/Time</th><th>Student</th><th>Adm No.</th><th>Class</th><th>Edited By</th><th>Previous Fee</th><th>New Fee</th><th>Difference</th><th>Reason</th></tr></thead>
        <tbody>{trs}</tbody></table></body></html>"""
        buf = io.BytesIO()
        pisa.CreatePDF(html_str, dest=buf)
        return Response(content=buf.getvalue(), media_type="application/pdf",
                         headers={"Content-Disposition": 'inline; filename="Fee_Edit_History.pdf"'})

    raise HTTPException(400, f"Unknown format '{format}' - use json, xlsx, or pdf")
