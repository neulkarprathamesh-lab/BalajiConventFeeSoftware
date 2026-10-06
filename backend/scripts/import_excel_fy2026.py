"""FY 2026-27 student import from the school's 20 Excel files (Fee hub ... .xlsx).

Usage (from the backend folder, with the backend venv):
    python scripts/import_excel_fy2026.py --excel-dir "D:\\fee software\\Fees\\Fee hub 26-27 All Class" --db <name>            # plan only (default)
    python scripts/import_excel_fy2026.py --excel-dir "..." --db <name> --apply --batch <id>                                   # write

Rules (see the import report for the full list):
  * Admission No. is the primary key. Names are never overwritten.
  * Excel summary rows (numeric Class) are ignored; identical rows that appear in two
    files are counted once.
  * An admission number used by two different Excel students is resolved only when
    exactly one of them matches the existing FeeHub student on name + class + section.
    Otherwise both rows are left unresolved (exception).
  * New students are created only with an exact existing fee structure and a non-zero
    Excel fee. Nothing is created that FeeHub already has (admission numbers are unique).
  * Fee structure: an existing structure with the same class, medium, stream, category
    (New -> new_only, Old -> returning_only) and total is used. No structure is created.
  * Opening paid = Excel Total Paid - genuine receipt total (never negative in the dry run).
    Stored in fee_details for 2026-27 (the supported opening-paid record). No receipts.
  * Zero-fee Excel rows never overwrite an existing non-zero fee; zero-fee new students
    are exceptions.
  * Bus: an Excel "Bus From" value is mapped only when it equals the area of exactly one
    existing bus stop. Otherwise the bus fields are left unchanged (exception).
  * Idempotent: a student/fee record already stamped with this batch id is skipped.
  * Every change writes an excel_import_audit document with before/after values.
  * Protected admission numbers are never touched.
"""
import argparse, json, os, re, sys, uuid, collections
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
from pymongo import MongoClient

PROTECTED = {"9999", "3278", "S1445", "DEMO0001"}
ACADEMIC_YEAR = "2026-27"
BACKEND = Path(__file__).resolve().parent.parent
ENV_FILE = Path(r"C:\balaji-fee\backend\.env")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def norm_text(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def norm_key(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def name_key(name):
    t = re.sub(r"[^a-z ]", " ", str(name or "").lower()).split()
    if len(t) >= 2:
        return (t[0], t[-1])
    return (t[0] if t else "", "")


def adm_norm(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip().upper()
    return s or None


def money(v):
    try:
        return round(float(v or 0), 2)
    except Exception:
        return None


def mobile_norm(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    digits = re.sub(r"\D", "", str(v))
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    return digits if len(digits) == 10 else None


# ---------------- Excel reading ----------------
def read_excel(excel_dir):
    # "~$name.xlsx" files are Excel lock files (a workbook open in Excel), not data.
    files = sorted(f for f in Path(excel_dir).glob("*.xlsx") if not f.name.startswith("~$"))
    out, summary = [], []
    for f in files:
        wb = openpyxl.load_workbook(f, data_only=True)
        ws = wb["Sheet1"]
        data = list(ws.iter_rows(values_only=True))
        hdr = [norm_text(c) for c in data[0]]
        for i, row in enumerate(data[1:], start=2):
            if not any(c not in (None, "") for c in row):
                continue
            rec = dict(zip(hdr, row))
            cls = rec.get("Class")
            if isinstance(cls, (int, float)) or (isinstance(cls, str) and cls.strip().isdigit()):
                summary.append({"file": f.name, "row": i, "count": cls})
                continue
            out.append({
                "file": f.name, "row": i, "label": norm_text(cls), "adm": adm_norm(rec.get("Adm No.")),
                "name": norm_text(rec.get("Name")), "fee": money(rec.get("Total Fee")), "paid": money(rec.get("Total Paid")),
                "balance": money(rec.get("Balance")), "mobile": mobile_norm(rec.get("Mobile No.")),
                "bus": norm_text(rec.get("Bus From")), "type": norm_text(rec.get("Student Type")),
                "status": norm_text(rec.get("Student Status")),
            })
    return files, summary, out


def dedupe(records):
    seen, distinct = {}, []
    for r in records:
        k = (r["adm"], norm_key(r["name"]), r["label"])
        if k in seen:
            seen[k]["overlap_files"].append(r["file"])
            continue
        r["overlap_files"] = []
        seen[k] = r
        distinct.append(r)
    return distinct


# ---------------- Label -> FeeHub class mapping ----------------
def map_label(label):
    """Excel class label -> (department code, class name, medium, stream, section) or None."""
    l = label.lower()
    sec = re.search(r"\b([abc])\b", l)
    section = sec.group(1).upper() if sec else None
    if l.startswith("nursery"):
        return ("EP", "Nursery", "English Medium", None, section)
    if l.startswith("k.g.ii"):
        return ("EP", "KG II", "English Medium", None, section)
    if l.startswith("k.g.i"):
        return ("EP", "KG I", "English Medium", None, section)
    if l.startswith("balwadi"):
        return ("MP", "Balwadi", "Semi Medium (Marathi)", None, section)
    if l.startswith("junior_shishu"):
        return ("MP", "Junior Shishuvihar", "Semi Medium (Marathi)", None, section)
    if l.startswith("senior_shishu"):
        return ("MP", "Senior Shishuvihar", "Semi Medium (Marathi)", None, section)
    m = re.match(r"(\d+)(st|nd|rd|th)(?![a-z])", l)
    if not m:
        return None
    n = int(m.group(1))
    if n in (11, 12):
        if "art" in l:
            stream = "Arts"
        elif "commerce" in l:
            stream = "Commerce"
        elif "science" in l and ("ele" in l or "fish" in l):
            stream = "Bi-Focal"
        elif "science" in l:
            stream = "Science"
        else:
            return None
        return ("JC", f"Class {n}", "Junior College", stream, section)
    semi = "semi" in l
    if n <= 8:
        return ("MP" if semi else "EP", f"Class {n}", "Semi Medium (Marathi)" if semi else "English Medium", None, section)
    if n in (9, 10):
        return ("SEC", f"Class {n}", "Semi Medium (Marathi)" if semi else "English Medium", None, section)
    return None


# ---------------- Plan ----------------
def build_plan(db, records, summary, files):
    depts = {d["code"]: d["id"] for d in db.departments.find({}, {"_id": 0})}
    classes = list(db.classes.find({}, {"_id": 0}))
    fees = list(db.fee_structures.find({}, {"_id": 0}))
    stops = list(db.bus_stops.find({}, {"_id": 0}))
    students = list(db.students.find({}, {"_id": 0}))
    receipts = list(db.receipts.find({"status": {"$ne": "cancelled"}}, {"_id": 0, "student_id": 1, "total": 1}))
    rec_total = collections.defaultdict(float)
    for r in receipts:
        rec_total[r.get("student_id")] += float(r.get("total") or 0)

    by_adm = collections.defaultdict(list)
    for s in students:
        by_adm[adm_norm(s.get("admission_no"))].append(s)
    adm_count = collections.Counter(r["adm"] for r in records)

    def class_id_for(dept_code, class_name, medium, stream):
        dept_id = depts.get(dept_code)
        hits = [c for c in classes if c.get("department_id") == dept_id and c.get("name") == class_name
                and (c.get("medium") == medium or (medium == "Junior College" and c.get("stream") == stream))
                and (stream is None or c.get("stream") == stream)]
        if dept_code == "JC":
            hits = [c for c in hits if c.get("stream") == stream]
        return (hits[0]["id"], dept_id) if len(hits) == 1 else (None, dept_id)

    def structure_for(class_id, medium, stream, status, total):
        want = "new_only" if status.lower() == "new" else ("returning_only" if status.lower() == "old" else None)
        hits = [f for f in fees if f.get("class_id") == class_id and (f.get("medium") == medium)
                and (stream is None or f.get("stream") == stream) and abs(float(f.get("total") or 0) - total) < 0.5
                and (f.get("applies_to") == want or f.get("applies_to") == "all")]
        # Identical copies (same class, medium, stream, category and total) are one
        # structure. Duplicates already in FeeHub are reported, never deleted.
        exact = [f for f in hits if f.get("applies_to") == want]
        if exact:
            hits = exact
        content = {(f.get("class_id"), f.get("medium"), f.get("stream"), f.get("applies_to"), float(f.get("total") or 0)) for f in hits}
        if len(content) != 1:
            return None
        return sorted(hits, key=lambda f: f.get("created_at") or "")[0]

    bus_by_area = collections.defaultdict(list)
    for s in stops:
        bus_by_area[norm_key(s.get("main_area"))].append(s)

    def bus_for(bus_label):
        if not bus_label or bus_label.upper() in ("NA", "NONE"):
            return None, None
        hits = bus_by_area.get(norm_key(bus_label), [])
        if len(hits) == 1:
            return hits[0], None
        return None, ("not found" if not hits else f"{len(hits)} stops share this area")

    actions = []
    exceptions = []

    def exc(r, reason, extra=None):
        exceptions.append({"file": r["file"], "row": r["row"], "adm": r["adm"], "name": r["name"], "label": r["label"],
                           "fee": r["fee"], "paid": r["paid"], "reason": reason, **(extra or {})})

    for r in records:
        a = r["adm"]
        if not a:
            exc(r, "no admission number"); continue
        if a in PROTECTED:
            exc(r, "protected record - not touched"); continue
        mp = map_label(r["label"])
        if not mp:
            exc(r, "class label not recognised"); continue
        dept_code, class_name, medium, stream, section = mp
        class_id, dept_id = class_id_for(dept_code, class_name, medium, stream)
        if not class_id:
            exc(r, f"no unique FeeHub class for {dept_code}/{class_name}/{medium}/{stream}"); continue
        existing = by_adm.get(a, [])
        if adm_count[a] > 1:
            # shared admission number: only a full-information match may resolve it
            group = [x for x in records if x["adm"] == a]
            if not existing:
                exc(r, "shared admission number with no FeeHub record - not created (number must stay unique)"); continue
            p = existing[0]
            full = (name_key(p["name"]) == name_key(r["name"]) and p.get("class_id") == class_id
                    and (p.get("section") or "") == (section or ""))
            others = [x for x in group if x is not r]
            if full and not any(name_key(p["name"]) == name_key(o["name"]) for o in others):
                pass  # resolved below
            else:
                exc(r, "shared admission number - not matched on full information (name+class+section)"); continue
        elif existing:
            p = existing[0]
            if name_key(p["name"]) != name_key(r["name"]):
                exc(r, "same admission number, different name - not updated", {"feehub_name": p["name"]}); continue
        else:
            p = None

        fee, paid, bal = r["fee"], r["paid"], r["balance"]
        if fee is None or paid is None or bal is None:
            exc(r, "non-numeric money"); continue
        if p is None:
            # NEW STUDENT
            if fee <= 0:
                exc(r, "zero fee for a new student - not created (confirm fee first)"); continue
            fs = structure_for(class_id, medium, stream, r["status"], fee)
            if not fs:
                exc(r, "no exact existing fee structure for this class/medium/category/total", {"fee": fee}); continue
            bus_stop, bus_issue = bus_for(r["bus"])
            if bus_issue:
                pass  # bus left empty; reported
            mob = r["mobile"]
            opening = round(paid, 2)
            actions.append({"op": "create", "adm": a, "name": r["name"], "file": r["file"], "row": r["row"],
                            "student": {"id": str(uuid.uuid4()), "admission_no": a, "name": r["name"], "department_id": dept_id,
                                        "class_id": class_id, "section": section, "medium": medium, "stream": stream,
                                        "fee_structure_id": fs["id"], "guardian_mobile": mob, "academic_year": ACADEMIC_YEAR,
                                        "status": "active", "student_type": r["type"] or None, "enrollment_status": r["status"] or None,
                                        "bus_required": bool(bus_stop), "bus_stop_no": bus_stop and bus_stop["stop_no"],
                                        "bus_stop_name": bus_stop and bus_stop.get("stop_name"), "bus_main_area": bus_stop and bus_stop.get("main_area"),
                                        "father_name": None, "address": None, "roll_no": None, "version": 1,
                                        "created_at": now_iso(), "imported_at": now_iso(), "imported_by": "excel-import-fy2026"},
                            "fee": {"total_fee": fee, "total_paid": opening, "balance_fee": bal, "receipts": 0.0},
                            "bus_issue": bus_issue, "excel": {k: r[k] for k in ("file", "row", "label", "fee", "paid", "balance", "bus", "type", "status")}})
            continue
        # EXISTING STUDENT: update Excel-authoritative fields
        changes = {}
        if p.get("class_id") != class_id: changes["class_id"] = class_id
        if p.get("department_id") != dept_id: changes["department_id"] = dept_id
        if (p.get("section") or None) != (section or None): changes["section"] = section
        if p.get("medium") != medium: changes["medium"] = medium
        if (p.get("stream") or None) != (stream or None): changes["stream"] = stream
        if r["mobile"] and p.get("guardian_mobile") != r["mobile"]: changes["guardian_mobile"] = r["mobile"]
        if r["type"] and p.get("student_type") != r["type"]: changes["student_type"] = r["type"]
        if r["status"] and p.get("enrollment_status") != r["status"]: changes["enrollment_status"] = r["status"]
        fee_note = None
        if fee > 0:
            fs = structure_for(class_id, medium, stream, r["status"], fee)
            cur = next((f for f in fees if f.get("id") == p.get("fee_structure_id")), None)
            if fs and (not cur or fs["id"] != cur["id"]):
                changes["fee_structure_id"] = fs["id"]
            elif not fs and (not cur or abs(float(cur.get("total") or 0) - fee) > 0.5):
                fee_note = "no exact existing fee structure - FeeHub structure kept"
        else:
            fee_note = "zero Excel fee - existing FeeHub fee kept"
        bus_stop, bus_issue = bus_for(r["bus"])
        if bus_stop and (p.get("bus_stop_no") != bus_stop["stop_no"]):
            changes.update({"bus_required": True, "bus_stop_no": bus_stop["stop_no"], "bus_stop_name": bus_stop.get("stop_name"), "bus_main_area": bus_stop.get("main_area")})
        rec_sum = rec_total.get(p["id"], 0.0)
        fee_action = None
        if fee > 0:
            residual = round(paid - rec_sum, 2)
            if residual < -0.5:
                exc(r, "Excel paid is LESS than genuine receipts - opening paid not written", {"receipts": rec_sum}); fee_action = None
            else:
                fd = db.fee_details.find_one({"student_id": p["id"], "academic_year": ACADEMIC_YEAR}, {"_id": 0})
                fee_action = {"total_fee": fee, "total_paid": max(residual, 0.0), "balance_fee": bal, "receipts": rec_sum,
                              "previous": {k: (fd or {}).get(k) for k in ("total_fee", "total_paid", "balance_fee")} if fd else None,
                              "has_fee_details": bool(fd), "already_stamped": bool(fd and fd.get("import_batch_id") == "__BATCH__")}
        if fee_note:
            exceptions.append({"file": r["file"], "row": r["row"], "adm": a, "name": r["name"], "label": r["label"],
                               "fee": fee, "paid": paid, "reason": fee_note, "student_id": p["id"]})
        if bus_issue and r["bus"] and r["bus"].upper() not in ("NA", "NONE"):
            exceptions.append({"file": r["file"], "row": r["row"], "adm": a, "name": r["name"], "label": r["label"],
                               "fee": fee, "paid": paid, "reason": f"bus '{r['bus']}' {bus_issue} - bus left unchanged", "student_id": p["id"]})
        if changes or fee_action:
            actions.append({"op": "update", "adm": a, "student_id": p["id"], "name": p["name"], "changes": changes,
                            "fee": fee_action, "file": r["file"], "row": r["row"],
                            "excel": {k: r[k] for k in ("label", "fee", "paid", "balance", "bus", "type", "status")}})
    return actions, exceptions


# ---------------- Apply ----------------
def apply_plan(db, actions, batch):
    stats = collections.Counter()
    for a in actions:
        if a["op"] == "create":
            s = a["student"]
            if db.students.find_one({"admission_no": s["admission_no"]}):
                stats["skipped_exists"] += 1; continue
            s["import_batch_id"] = batch
            db.students.insert_one(dict(s))
            db.excel_import_audit.insert_one({"batch": batch, "action": "create_student", "student_id": s["id"], "admission_no": s["admission_no"],
                                              "after": {k: s.get(k) for k in ("name", "class_id", "section", "medium", "stream", "fee_structure_id", "guardian_mobile", "bus_stop_no")},
                                              "excel": a["excel"], "at": now_iso()})
            stats["students_created"] += 1
            _write_fee(db, batch, s["id"], a["fee"], a["adm"], created=True, audit=True)
            stats["fee_records_created"] += 1
        else:
            cur = db.students.find_one({"id": a["student_id"]}, {"_id": 0})
            if not cur:
                stats["missing"] += 1; continue
            if cur.get("import_batch_id") == batch:
                stats["already_applied"] += 1
            elif a["changes"]:
                before = {k: cur.get(k) for k in a["changes"]}
                upd = dict(a["changes"]); upd.update({"import_batch_id": batch, "imported_at": now_iso(),
                                                      "version": int(cur.get("version") or 1) + 1})
                db.students.update_one({"id": cur["id"]}, {"$set": upd})
                db.excel_import_audit.insert_one({"batch": batch, "action": "update_student", "student_id": cur["id"], "admission_no": a["adm"],
                                                  "before": before, "after": a["changes"], "excel": a["excel"], "at": now_iso()})
                stats["students_updated"] += 1
            else:
                stats["students_unchanged"] += 1
            if a["fee"]:
                if _write_fee(db, batch, cur["id"], a["fee"], a["adm"], created=False, audit=True):
                    stats["fee_records_written"] += 1
    return stats


def _write_fee(db, batch, sid, fee, adm, created, audit):
    if fee is None:
        return False
    cur = db.fee_details.find_one({"student_id": sid, "academic_year": ACADEMIC_YEAR}, {"_id": 0})
    if cur and cur.get("import_batch_id") == batch:
        return False
    doc = {"total_fee": fee["total_fee"], "total_paid": fee["total_paid"], "balance_fee": fee["balance_fee"],
           "import_batch_id": batch, "source": "excel_import_fy2026", "updated_at": now_iso(), "updated_by": "excel-import-fy2026"}
    if cur:
        db.fee_details.update_one({"student_id": sid, "academic_year": ACADEMIC_YEAR}, {"$set": doc})
    else:
        db.fee_details.insert_one({"id": str(uuid.uuid4()), "student_id": sid, "academic_year": ACADEMIC_YEAR,
                                   "admission_no": adm, "created_at": now_iso(), "created_by": "excel-import-fy2026",
                                   "remarks": "Opening paid from Excel FY2026-27 import (no receipts created)", **doc})
    if audit:
        db.excel_import_audit.insert_one({"batch": batch, "action": "fee_details", "student_id": sid, "admission_no": adm,
                                          "before": {k: (cur or {}).get(k) for k in ("total_fee", "total_paid", "balance_fee")} if cur else None,
                                          "after": {k: doc[k] for k in ("total_fee", "total_paid", "balance_fee")}, "at": now_iso()})
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel-dir", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--batch", default="excel-fy2026-27-20261006")
    ap.add_argument("--out", required=True, help="folder for plan/report files")
    a = ap.parse_args()
    env = {}
    for line in open(ENV_FILE, encoding="utf-8-sig"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); env[k] = v
    client = MongoClient(env["MONGO_URL"], serverSelectionTimeoutMS=8000)
    db = client[a.db]
    files, summary, raw = read_excel(a.excel_dir)
    records = dedupe(raw)
    actions, exceptions = build_plan(db, records, summary, files)
    # stamp fee "already_stamped" for idempotency reporting
    stats_plan = collections.Counter(x["op"] for x in actions)
    os.makedirs(a.out, exist_ok=True)
    plan = {"batch": a.batch, "db": a.db, "files": len(files), "raw_rows": len(raw), "summary_rows": len(summary),
            "distinct_records": len(records), "actions": collections.Counter(x["op"] for x in actions), "exceptions": len(exceptions),
            "generated_at": now_iso()}
    json.dump({"summary": plan, "actions": actions, "exceptions": exceptions}, open(os.path.join(a.out, "plan.json"), "w", encoding="utf-8"), default=str, indent=1)
    print(json.dumps({**plan, "actions": dict(plan["actions"])}, indent=1, default=str))
    if a.apply:
        # Guard: refuse to write into an empty or wrong database (e.g. a mistyped --db name).
        if db.students.count_documents({}) < 1000:
            sys.exit(f"refusing to apply: database {a.db!r} does not look like the FeeHub student database")
        stats = apply_plan(db, actions, a.batch)
        db.excel_import_audit.insert_one({"batch": a.batch, "action": "batch_summary", "stats": dict(stats),
                                          "exceptions": len(exceptions), "at": now_iso()})
        json.dump({"stats": dict(stats)}, open(os.path.join(a.out, "apply-stats.json"), "w"), indent=1)
        print("APPLIED", dict(stats))


if __name__ == "__main__":
    main()
