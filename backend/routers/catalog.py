"""Departments, Classes, Fee Heads, Fee Structures + bulk import, promotion, rollover, seed-2026."""
import json as _json
from typing import Any, Dict, List, Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from core import (
    db, DepartmentIn, ClassIn, FeeHeadIn, FeeStructureIn, PromoteIn, RolloverIn,
    audit, gen_id, get_current_user, now_iso, require_roles, APP_ROOT,
)

router = APIRouter(prefix="/api", tags=["catalog"])

# ---------- Departments ----------
@router.get("/departments")
async def list_departments(user = Depends(get_current_user)):
    return await db.departments.find({}, {"_id":0}).to_list(100)

@router.post("/departments")
async def create_department(body: DepartmentIn, user = Depends(require_roles("administrator"))):
    did = gen_id()
    doc = {"id": did, **body.model_dump(), "created_at": now_iso()}
    await db.departments.insert_one(doc)
    await audit(user, "create", "department", did, body.model_dump())
    return {k:v for k,v in doc.items() if k != "_id"}

# ---------- Classes ----------
@router.get("/classes")
async def list_classes(department_id: Optional[str] = None, user = Depends(get_current_user)):
    q = {"department_id": department_id} if department_id else {}
    return await db.classes.find(q, {"_id":0}).to_list(500)

@router.post("/classes")
async def create_class(body: ClassIn, user = Depends(require_roles("administrator","manager"))):
    cid = gen_id()
    doc = {"id": cid, **body.model_dump(), "created_at": now_iso()}
    await db.classes.insert_one(doc)
    await audit(user, "create", "class", cid, body.model_dump())
    return {k:v for k,v in doc.items() if k != "_id"}

# ---------- Fee Heads ----------
@router.get("/fee-heads")
async def list_fee_heads(user = Depends(get_current_user)):
    return await db.fee_heads.find({}, {"_id":0}).to_list(200)

@router.post("/fee-heads")
async def create_fee_head(body: FeeHeadIn, user = Depends(require_roles("administrator","manager"))):
    fid = gen_id()
    doc = {"id": fid, **body.model_dump(), "created_at": now_iso()}
    await db.fee_heads.insert_one(doc)
    await audit(user, "create", "fee_head", fid, body.model_dump())
    return {k:v for k,v in doc.items() if k != "_id"}

# ---------- Fee Structures ----------
@router.get("/fee-structures")
async def list_fee_structures(department_id: Optional[str] = None, class_id: Optional[str] = None, user = Depends(get_current_user)):
    q = {}
    if department_id: q["department_id"] = department_id
    if class_id: q["class_id"] = class_id
    return await db.fee_structures.find(q, {"_id":0}).to_list(500)

_MEDIUM_ORDER = ["English Medium", "Semi Medium (Marathi)", "Junior College"]
_APPLIES_LABEL = {"all": "", "new_only": "New Admission", "returning_only": "Continuing"}
_CLASS_ORDER = ["Nursery", "KG I", "KG II", "Junior Shishuvihar", "Senior Shishuvihar", "Balwadi"]

def _fee_pdf_sort_key(r: dict):
    cn = r.get("class_name", "")
    if cn in _CLASS_ORDER:
        idx = _CLASS_ORDER.index(cn)
    elif cn.startswith("Class "):
        try:
            idx = 100 + int(cn.split(" ")[1])
        except Exception:
            idx = 200
    else:
        idx = 300
    return (idx, r.get("stream") or "", r.get("applies_to") or "")

def _inr(n) -> str:
    try:
        return "Rs. {:,.0f}".format(float(n))
    except Exception:
        return "-"

def _build_fee_structure_pdf_html(academic_year: str, rows: List[dict]) -> str:
    import html as _html
    from collections import defaultdict as _dd
    by_medium: Dict[str, List[dict]] = _dd(list)
    for r in rows:
        by_medium[r.get("medium", "Other")].append(r)
    medium_blocks = []
    orderd = [m for m in _MEDIUM_ORDER if m in by_medium] + [m for m in by_medium if m not in _MEDIUM_ORDER]
    for medium in orderd:
        medium_rows = sorted(by_medium[medium], key=_fee_pdf_sort_key)
        trs = []
        for r in medium_rows:
            label = _html.escape(r.get("class_name", ""))
            if r.get("stream"):
                label += " &middot; " + _html.escape(r["stream"])
            tag = _APPLIES_LABEL.get(r.get("applies_to", "all"), "")
            if tag:
                label += f' <span class="tag">{tag}</span>'
            bits = []
            if r.get("admission_fee"): bits.append(f"Admission {_inr(r['admission_fee'])}")
            if r.get("continuation_fee"): bits.append(f"Continuation {_inr(r['continuation_fee'])}")
            if r.get("term_fee"): bits.append(f"Term {_inr(r['term_fee'])}")
            if r.get("practical_fee"): bits.append(f"Practical {_inr(r['practical_fee'])}")
            insts = r.get("tuition_installments") or []
            if insts:
                inst_str = " + ".join(f"{i.get('amount',0):,.0f}" for i in insts)
                bits.append(f"Tuition ({inst_str}) = {_inr(r.get('tuition_total', 0))}")
            elif r.get("tuition_total"):
                bits.append(f"Tuition {_inr(r['tuition_total'])}")
            trs.append(f"<tr><td class='cls'>{label}</td><td class='bits'>{' &nbsp;&middot;&nbsp; '.join(bits)}</td>"
                        f"<td class='total'>{_inr(r.get('total', 0))}</td></tr>")
        medium_blocks.append(
            f"<h3>{_html.escape(medium)}</h3>"
            f"<table><thead><tr><th class='cls'>Class</th><th class='bits'>Fee Heads</th><th class='total'>Total</th></tr></thead>"
            f"<tbody>{''.join(trs)}</tbody></table>"
        )
    return f"""<html><head><style>
      @page {{ size: A4; margin: 16mm 14mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 10px; }}
      .cover {{ text-align: center; padding: 20px 0 14px; border-bottom: 3px double #333; margin-bottom: 18px; }}
      .cover h1 {{ font-size: 22px; margin: 4px 0; }}
      .cover .sub {{ font-size: 11px; color: #444; margin: 2px 0; }}
      .cover .badge {{ display:inline-block; margin-top:12px; padding:5px 16px; border:2px solid #222; font-weight:bold; }}
      h3 {{ font-size: 12px; margin-top: 14px; margin-bottom: 4px; }}
      table {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9.5px; }}
      th {{ background: #f0f0f0; text-align: left; padding: 4px 6px; border: 1px solid #999; }}
      td {{ padding: 3px 6px; border: 1px solid #ccc; }}
      td.total, th.total {{ text-align: right; font-weight: bold; width: 85px; }}
      td.cls {{ width: 140px; font-weight: bold; }}
      .tag {{ font-size: 8px; padding: 1px 4px; background:#fff3cd; color:#8a6300; }}
    </style></head><body>
    <div class="cover">
      <h1>BALAJI CONVENT &amp; JUNIOR COLLEGE</h1>
      <div class="sub">BUTIBORI &middot; DIST. NAGPUR &mdash; 441122</div>
      <div class="badge">FEE STRUCTURE &middot; {_html.escape(academic_year)}</div>
    </div>
    {''.join(medium_blocks) if medium_blocks else '<p>No fee structures loaded for this academic year yet.</p>'}
    </body></html>"""

@router.get("/fee-structures/pdf")
async def fee_structures_pdf(academic_year: str = "2026-27", user = Depends(get_current_user)):
    """Server-generated Fee Structure PDF for the given academic year — the same figures
    shown in Fee Structure / Fee Brochure, rendered as a real .pdf so any client PC on the
    LAN gets an identical, print-ready document with one click (no local print driver or
    'Save as PDF' step needed)."""
    from fastapi import Response
    import io
    from xhtml2pdf import pisa
    rows = await db.fee_structures.find({"academic_year": academic_year}, {"_id": 0}).to_list(500)
    html_str = _build_fee_structure_pdf_html(academic_year, rows)
    buf = io.BytesIO()
    result = pisa.CreatePDF(html_str, dest=buf)
    if result.err:
        raise HTTPException(500, "PDF generation failed")
    pdf_bytes = buf.getvalue()
    filename = f"Fee_Structure_{academic_year}.pdf"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )

@router.post("/fee-structures")
async def create_fee_structure(body: FeeStructureIn, user = Depends(require_roles("administrator","manager","accountant"))):
    fid = gen_id()
    total = sum(float(i.get("amount", 0)) for i in body.items)
    doc = {"id": fid, **body.model_dump(), "total": total, "created_at": now_iso()}
    await db.fee_structures.insert_one(doc)
    await audit(user, "create", "fee_structure", fid, {"total": total})
    return {k:v for k,v in doc.items() if k != "_id"}

@router.post("/fee-structures/{fid}/duplicate")
async def duplicate_fee_structure(fid: str, body: Dict[str, Any], user = Depends(require_roles("administrator","manager","accountant"))):
    src = await db.fee_structures.find_one({"id": fid}, {"_id":0})
    if not src: raise HTTPException(404, "Source structure not found")
    to_class_id = body.get("to_class_id")
    to_academic_year = body.get("to_academic_year") or src.get("academic_year")
    if not to_class_id: raise HTTPException(400, "to_class_id is required")
    to_class = await db.classes.find_one({"id": to_class_id})
    if not to_class: raise HTTPException(400, "Target class not found")
    dup = await db.fee_structures.find_one({"class_id": to_class_id, "academic_year": to_academic_year})
    if dup:
        raise HTTPException(400, f"A structure already exists for that class + academic year")
    new_id = gen_id()
    doc = {
        "id": new_id,
        "department_id": to_class["department_id"],
        "class_id": to_class_id,
        "academic_year": to_academic_year,
        "items": src.get("items", []),
        "total": src.get("total", 0),
        "cloned_from": fid,
        "created_at": now_iso(),
    }
    await db.fee_structures.insert_one(doc)
    await audit(user, "duplicate", "fee_structure", new_id, {"from": fid, "to_class": to_class_id})
    return {k:v for k,v in doc.items() if k != "_id"}

# ---------- Fee-Structure Bulk Import/Delete ----------
@router.post("/fee-structures/bulk-import")
async def bulk_import_fee_structures(body: Dict[str, Any], user = Depends(require_roles("administrator","manager","accountant"))):
    """Body: {rows: [{department_code, class_name, academic_year, fee_head_name, amount}], batch_id?}"""
    rows = body.get("rows", [])
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "rows must be a non-empty array")
    batch_id = body.get("batch_id") or gen_id()
    depts = {d["code"]: d for d in await db.departments.find({}, {"_id":0}).to_list(100)}
    classes = await db.classes.find({}, {"_id":0}).to_list(500)
    groups: Dict[tuple, List[dict]] = {}
    errors: List[dict] = []
    for idx, r in enumerate(rows):
        try:
            dcode = str(r.get("department_code","")).strip().upper()
            cname = str(r.get("class_name","")).strip()
            ay = str(r.get("academic_year","")).strip() or "2026-27"
            head = str(r.get("fee_head_name","")).strip()
            amt = float(r.get("amount") or 0)
            if not dcode or not cname or not head:
                errors.append({"row": idx+1, "error": "department_code, class_name, fee_head_name required", "data": r}); continue
            if amt <= 0:
                errors.append({"row": idx+1, "error": "amount must be > 0", "data": r}); continue
            if dcode not in depts:
                errors.append({"row": idx+1, "error": f"unknown department code {dcode}", "data": r}); continue
            d = depts[dcode]
            cls = next((c for c in classes if c["department_id"]==d["id"] and c["name"].lower()==cname.lower()), None)
            if not cls:
                errors.append({"row": idx+1, "error": f"unknown class '{cname}' in {dcode}", "data": r}); continue
            groups.setdefault((d["id"], cls["id"], ay), []).append({"fee_head_name": head, "amount": amt})
        except Exception as e:
            errors.append({"row": idx+1, "error": str(e), "data": r})
    created, updated, created_ids = 0, 0, []
    for (dept_id, class_id, ay), items in groups.items():
        existing = await db.fee_structures.find_one({"department_id": dept_id, "class_id": class_id, "academic_year": ay})
        total = sum(it["amount"] for it in items)
        if existing:
            existing_items = existing.get("items", [])
            by_name = {it.get("fee_head_name","").strip().lower(): idx for idx, it in enumerate(existing_items)}
            for it in items:
                key = it["fee_head_name"].strip().lower()
                if key in by_name:
                    existing_items[by_name[key]]["amount"] = it["amount"]
                else:
                    existing_items.append({"fee_head_id": None, "fee_head_name": it["fee_head_name"], "amount": it["amount"]})
            new_total = sum(float(x.get("amount",0)) for x in existing_items)
            await db.fee_structures.update_one({"id": existing["id"]}, {"$set": {"items": existing_items, "total": new_total, "last_import_batch_id": batch_id, "last_import_at": now_iso()}})
            updated += 1
        else:
            fid = gen_id()
            doc = {
                "id": fid, "department_id": dept_id, "class_id": class_id, "academic_year": ay,
                "items": [{"fee_head_id": None, **it} for it in items],
                "total": total, "import_batch_id": batch_id,
                "created_at": now_iso(), "created_by": user["name"],
            }
            await db.fee_structures.insert_one(doc)
            created_ids.append(fid); created += 1
    await db.import_batches.insert_one({
        "id": batch_id, "type": "fee_structures", "created": created, "updated": updated,
        "errors_count": len(errors), "total_rows": len(rows), "created_ids": created_ids,
        "user_id": user["id"], "user_name": user["name"], "created_at": now_iso(),
    })
    await audit(user, "bulk_import", "fee_structure", batch_id, {"created": created, "updated": updated, "errors": len(errors)})
    return {"created": created, "skipped": updated, "errors": errors, "total": len(rows), "batch_id": batch_id, "created_ids": created_ids}

@router.post("/fee-structures/bulk-delete")
async def bulk_delete_fee_structures(body: Dict[str, Any], user = Depends(require_roles("administrator","manager"))):
    batch_id = body.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id required")
    structs = await db.fee_structures.find({"import_batch_id": batch_id}, {"_id":0}).to_list(1000)
    if not structs:
        return {"deleted": 0, "protected_referenced": 0}
    used = await db.students.distinct("fee_structure_id", {"fee_structure_id": {"$in": [s["id"] for s in structs]}})
    protected_ids = set([u for u in used if u])
    deletable = [s["id"] for s in structs if s["id"] not in protected_ids]
    if deletable:
        await db.fee_structures.delete_many({"id": {"$in": deletable}})
    await db.import_batches.update_one({"id": batch_id}, {"$set": {"undone_at": now_iso(), "undone_by": user["name"], "undone_deleted": len(deletable), "undone_protected": len(protected_ids)}})
    await audit(user, "bulk_delete", "fee_structure", batch_id, {"deleted": len(deletable), "protected": len(protected_ids)})
    return {"deleted": len(deletable), "protected_referenced": len(protected_ids)}

# ---------- Imports history ----------
@router.get("/imports/latest")
async def latest_import_batch(kind: Literal["students","fee_structures"], user = Depends(get_current_user)):
    doc = await db.import_batches.find_one({"type": kind, "undone_at": {"$exists": False}}, {"_id":0}, sort=[("created_at", -1)])
    return doc or {}

@router.get("/imports/history")
async def imports_history(
    kind: Optional[Literal["students","fee_structures"]] = None,
    limit: int = 100,
    user = Depends(get_current_user),
):
    q: Dict[str, Any] = {}
    if kind: q["type"] = kind
    return await db.import_batches.find(q, {"_id":0}).sort("created_at", -1).limit(limit).to_list(limit)

# ---------- Promotion + Rollover + Seed 2026 ----------
@router.post("/students/promote")
async def promote_students(body: PromoteIn, user = Depends(require_roles("administrator","manager"))):
    from_cls = await db.classes.find_one({"id": body.from_class_id})
    to_cls = await db.classes.find_one({"id": body.to_class_id})
    if not from_cls or not to_cls:
        raise HTTPException(400, "Invalid class")
    q = {"class_id": body.from_class_id, "status": "active"}
    if body.section: q["section"] = body.section
    students = await db.students.find(q, {"_id":0}).to_list(5000)
    upd: Dict[str, Any] = {"class_id": body.to_class_id, "department_id": to_cls["department_id"]}
    if body.to_fee_structure_id:
        upd["fee_structure_id"] = body.to_fee_structure_id
    else:
        upd["fee_structure_id"] = None
    for s in students:
        await db.students.update_one({"id": s["id"]}, {"$set": upd, "$push": {"promotion_history": {"from_class_id": body.from_class_id, "to_class_id": body.to_class_id, "at": now_iso(), "by": user["name"], "academic_year": body.new_academic_year}}})
    await audit(user, "promote", "class", body.to_class_id, {"count": len(students), "from": from_cls["name"], "to": to_cls["name"]})
    return {"promoted": len(students), "from_class": from_cls["name"], "to_class": to_cls["name"]}

@router.post("/fee-structures/rollover")
async def rollover_fee_structures(body: RolloverIn, user = Depends(require_roles("administrator","manager"))):
    existing = await db.fee_structures.find({"academic_year": body.from_academic_year}, {"_id":0}).to_list(500)
    created = 0
    for fs in existing:
        dup = await db.fee_structures.find_one({"academic_year": body.to_academic_year, "department_id": fs["department_id"], "class_id": fs["class_id"]})
        if dup: continue
        new_fs = {
            "id": gen_id(),
            "department_id": fs["department_id"], "class_id": fs["class_id"],
            "academic_year": body.to_academic_year,
            "items": fs.get("items", []), "total": fs.get("total", 0),
            "cloned_from": fs["id"], "created_at": now_iso(),
        }
        await db.fee_structures.insert_one(new_fs); created += 1
    await db.departments.update_many({"academic_year": body.from_academic_year}, {"$set": {"academic_year": body.to_academic_year}})
    await audit(user, "rollover", "fee_structure", "", {"from": body.from_academic_year, "to": body.to_academic_year, "created": created})
    return {"created": created, "from": body.from_academic_year, "to": body.to_academic_year}

AY_SEED_FILES = {
    "2026-27": "fee_structure_2026.json",
    "2025-26": "fee_structure_2025.json",
}

@router.post("/fee-structures/seed-2026")
async def seed_2026_fee_structures(replace: bool = False,
                                    user = Depends(require_roles("administrator","manager"))):
    """Back-compat alias for seeding 2026-27 specifically. See seed_fee_structures_for_year."""
    return await seed_fee_structures_for_year("2026-27", replace, user)

@router.post("/fee-structures/seed")
async def seed_fee_structures_for_year(academic_year: str, replace: bool = False,
                                        user = Depends(require_roles("administrator","manager"))):
    """Seed fee structures for a given academic year (currently '2026-27' or '2025-26')
    from backend/data/fee_structure_<year>.json (previously pointed at /app/memory/...,
    a Linux-container path that never existed on Windows, with no file behind it either
    way - this endpoint always 500'd, which is why fee_structures was empty all session).
    Each row carries `medium`, `class_name`, optional `stream`, `admission_fee`, `continuation_fee`,
    `tuition_installments`, `term_fee`, `practical_fee`, `tuition_total`, and `applies_to`.
    Academic years are kept fully separate - each year's rows are scoped to that year only
    and are never mixed with another year's data."""
    filename = AY_SEED_FILES.get(academic_year)
    if not filename:
        raise HTTPException(400, f"No seed file mapped for academic year {academic_year!r}. Known years: {list(AY_SEED_FILES)}")
    rows: List[dict] = []
    seed_path = APP_ROOT / "backend" / "data" / filename
    try:
        with open(seed_path, "r", encoding="utf-8") as f:
            rows = _json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Cannot read seed file at {seed_path}: {e}")
    ay = academic_year
    depts = {d["code"]: d for d in await db.departments.find({}, {"_id":0}).to_list(50)}
    def pick_dept(medium: str, class_name: str):
        cn = class_name.lower()
        if medium == "Junior College": return depts.get("JC")
        if "class 9" in cn or "class 10" in cn:
            return depts.get("SEC")   # Secondary dept covers 9th/10th for both English and Marathi (Semi)
        if medium == "English Medium":
            return depts.get("EP")
        return depts.get("MP")   # Semi Medium (Marathi)

    fee_head_names = ["Admission Fee", "Continuation Fee", "Tuition I", "Tuition II", "Tuition III",
                      "Tuition", "Term Fee", "Practical Fee"]
    fh_by_name: Dict[str, dict] = {fh["name"]: fh for fh in await db.fee_heads.find({}, {"_id":0}).to_list(200)}
    for nm in fee_head_names:
        if nm not in fh_by_name:
            code = nm.replace(" ","_").upper()[:8]
            fh = {"id": gen_id(), "name": nm, "code": code, "category":"school", "created_at": now_iso()}
            await db.fee_heads.insert_one(fh); fh_by_name[nm] = fh

    if replace:
        await db.fee_structures.delete_many({"academic_year": ay, "seeded_from": filename})

    created_classes = 0; created_structures = 0; skipped = 0
    for row in rows:
        cname = row["class_name"]
        medium = row["medium"]
        stream = row.get("stream")
        applies_to = row.get("applies_to", "all")
        d = pick_dept(medium, cname)
        if not d:
            continue
        class_lookup: Dict[str, Any] = {"department_id": d["id"], "name": cname, "medium": medium}
        if stream:
            class_lookup["stream"] = stream
        cls = await db.classes.find_one(class_lookup, {"_id":0})
        if not cls:
            cls = {"id": gen_id(), **class_lookup, "created_at": now_iso()}
            await db.classes.insert_one(cls); created_classes += 1
        fs_lookup: Dict[str, Any] = {"medium": medium, "class_name": cname,
                                     "academic_year": ay, "applies_to": applies_to}
        if stream:
            fs_lookup["stream"] = stream
        existing = await db.fee_structures.find_one(fs_lookup)
        if existing:
            skipped += 1; continue
        # Build items[]
        items: List[dict] = []
        if row.get("admission_fee", 0) > 0:
            items.append({"fee_head_id": fh_by_name["Admission Fee"]["id"], "fee_head_name": "Admission Fee",
                          "amount": float(row["admission_fee"]), "installment": None, "kind": "admission"})
        if row.get("continuation_fee", 0) > 0:
            items.append({"fee_head_id": fh_by_name["Continuation Fee"]["id"], "fee_head_name": "Continuation Fee",
                          "amount": float(row["continuation_fee"]), "installment": None, "kind": "continuation"})
        if row.get("term_fee", 0) > 0:
            items.append({"fee_head_id": fh_by_name["Term Fee"]["id"], "fee_head_name": "Term Fee",
                          "amount": float(row["term_fee"]), "installment": None, "kind": "term"})
        if row.get("practical_fee", 0) > 0:
            items.append({"fee_head_id": fh_by_name["Practical Fee"]["id"], "fee_head_name": "Practical Fee",
                          "amount": float(row["practical_fee"]), "installment": None, "kind": "practical"})
        for inst in row.get("tuition_installments", []):
            head_name = inst.get("name") or "Tuition"
            fh = fh_by_name.get(head_name)
            if not fh:
                fh = {"id": gen_id(), "name": head_name, "code": head_name.replace(" ","_").upper()[:8], "category":"school", "created_at": now_iso()}
                await db.fee_heads.insert_one(fh); fh_by_name[head_name] = fh
            items.append({"fee_head_id": fh["id"], "fee_head_name": head_name,
                          "amount": float(inst["amount"]), "installment": head_name,
                          "due_date": inst.get("due_date"), "kind": "tuition"})
        total = sum(it["amount"] for it in items)
        await db.fee_structures.insert_one({
            "id": gen_id(),
            "department_id": d["id"], "class_id": cls["id"],
            "medium": medium, "class_name": cname, "stream": stream,
            "academic_year": ay, "applies_to": applies_to,
            "admission_fee": float(row.get("admission_fee", 0)),
            "continuation_fee": float(row.get("continuation_fee", 0)),
            "term_fee": float(row.get("term_fee", 0)),
            "practical_fee": float(row.get("practical_fee", 0)),
            "tuition_total": float(row.get("tuition_total", 0)),
            "tuition_installments": row.get("tuition_installments", []),
            "items": items, "total": total,
            "active": True, "notes": row.get("notes"),
            "seeded_from": filename, "created_at": now_iso(),
        })
        created_structures += 1
    await audit(user, "seed", "fee_structure", "", {"classes": created_classes, "structures": created_structures, "skipped": skipped, "replace": replace, "academic_year": ay})
    return {"classes_created": created_classes, "structures_created": created_structures,
            "skipped": skipped, "total_rows": len(rows), "academic_year": ay, "replaced": replace}


@router.get("/fee-structures/resolve")
async def resolve_structure_endpoint(
    medium: str, class_name: str,
    stream: Optional[str] = None,
    first_year_in_college: bool = False,
    academic_year: str = "2026-27",
    user = Depends(get_current_user),
):
    """Utility: given (medium, class_name, stream, first_year_in_college), returns the resolved structure or 404."""
    from core import resolve_fee_structure, canonical_medium, canonical_stream
    med = canonical_medium(medium) or medium
    stm = canonical_stream(stream) if stream else None
    fs = await resolve_fee_structure(med, class_name, stm, first_year_in_college, academic_year)
    if not fs:
        raise HTTPException(404, f"No structure for {med} · {class_name}" + (f" · {stm}" if stm else ""))
    return fs
