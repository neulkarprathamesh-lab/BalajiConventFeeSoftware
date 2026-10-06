"""FY 2026-27 Excel import, corrected rule: EVERY distinct student in the 20 files is imported.

Rules
  * Source of truth: the 20 Excel files. Summary/total rows (numeric Class) are not students.
  * Identical rows that appear in two files are one student.
  * Admission number shared by different students (or an Excel number already used in FeeHub
    by a different person): the existing FeeHub student keeps the number only when that student
    is the one matching the Excel row (name, and class+section where the number is shared).
    Every other Excel student with that number gets a NEW unique admission number
    "IMP-<excel number>" (suffix -2, -3 ... if needed), checked against ALL existing numbers.
    The original number is kept in source_admission_no. Nothing is merged or deleted.
  * Fee: existing students keep their valid FeeHub fee structure when Excel fee is zero or has no
    exact structure. Opening paid = Excel Total Paid minus genuine receipts (fee_details 2026-27).
    No receipts are created. Zero-fee new students are created with no structure and zero fee.
  * Bus: mapped only when the Excel area equals one bus stop. Otherwise the bus fields are left
    unchanged and the raw Excel value is kept in source_bus_from (review item). Student still imported.
  * Idempotent: each student carries import_key (source number | name | class label). Re-runs find it
    and make no changes (students and fee records are stamped with the batch id).

Usage:
    python scripts/import_excel_fy2026_v2.py --excel-dir "..." --db <name> --out <folder> [--apply]
"""
import argparse, collections, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_excel_fy2026 as imp  # noqa: E402  (reader, dedupe, class/label mapping, normalisers)
from pymongo import MongoClient  # noqa: E402
import uuid  # noqa: E402

ACADEMIC_YEAR = "2026-27"
BATCH = "excel-fy2026-27-corrected-20261006"
ENV_FILE = Path(r"C:\balaji-fee\backend\.env")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def key_of(r):
    """Stable identity of one Excel student row (survives re-runs)."""
    return f"{r['adm']}|{' '.join(r['name'].lower().split())}|{r['label'].lower()}"


def name_matches(a, b):
    return imp.name_key(a) == imp.name_key(b)


def build(db, raw):
    depts = {d["code"]: d["id"] for d in db.departments.find({}, {"_id": 0})}
    classes = list(db.classes.find({}, {"_id": 0}))
    fees = list(db.fee_structures.find({}, {"_id": 0}))
    stops = list(db.bus_stops.find({}, {"_id": 0}))
    students = list(db.students.find({}, {"_id": 0}))
    rec_total = collections.defaultdict(float)
    for r in db.receipts.find({"status": {"$ne": "cancelled"}}, {"_id": 0, "student_id": 1, "total": 1}):
        rec_total[r["student_id"]] += float(r.get("total") or 0)
    fd_all = {(f["student_id"], f["academic_year"]): f for f in db.fee_details.find({}, {"_id": 0})}
    all_adm = {imp.adm_norm(s.get("admission_no")) for s in students}
    by_key = {s["import_key"]: s for s in students if s.get("import_key")}
    active_by_adm = collections.defaultdict(list)
    for s in students:
        if s.get("status") != "duplicate":
            active_by_adm[imp.adm_norm(s.get("admission_no"))].append(s)
    class_by_id = {c["id"]: c for c in classes}
    fee_by_id = {f["id"]: f for f in fees}

    def class_id_for(dept_code, class_name, medium, stream):
        did = depts.get(dept_code)
        hits = [c for c in classes if c.get("department_id") == did and c.get("name") == class_name
                and c.get("medium") == medium and (dept_code != "JC" or c.get("stream") == stream)]
        return hits[0]["id"] if len(hits) == 1 else None, did

    def structure_for(class_id, medium, stream, status, total):
        want = "new_only" if status.lower() == "new" else ("returning_only" if status.lower() == "old" else None)
        hits = [f for f in fees if f.get("class_id") == class_id and f.get("medium") == medium
                and (stream is None or f.get("stream") == stream) and abs(float(f.get("total") or 0) - total) < 0.5
                and (f.get("applies_to") == want or f.get("applies_to") == "all")]
        exact = [f for f in hits if f.get("applies_to") == want]
        if exact:
            hits = exact
        content = {(f.get("class_id"), f.get("medium"), f.get("stream"), f.get("applies_to"), float(f.get("total") or 0)) for f in hits}
        if len(content) != 1:
            return None
        return sorted(hits, key=lambda f: f.get("created_at") or "")[0]

    stops_by_area = collections.defaultdict(list)
    for s in stops:
        stops_by_area[imp.norm_key(s.get("main_area"))].append(s)

    def bus_for(label):
        if not label or label.upper() in ("NA", "NONE"):
            return None, None
        hits = stops_by_area.get(imp.norm_key(label), [])
        return (hits[0], None) if len(hits) == 1 else (None, "not found" if not hits else f"{len(hits)} stops share this area")

    distinct = imp.dedupe(raw)
    groups = collections.defaultdict(list)
    for r in distinct:
        groups[r["adm"]].append(r)
    assigned = set(all_adm)
    decisions, review = [], []

    def new_number(adm):
        cand = f"IMP-{adm}"
        n = 2
        while cand in assigned:
            cand = f"IMP-{adm}-{n}"
            n += 1
        assigned.add(cand)
        return cand

    merged_by_adm = {imp.adm_norm(s.get("admission_no")): s for s in students if s.get("status") == "duplicate"}
    surviving_of = {}
    for a in db.audit_log.find({"action": "duplicate_student_consolidation"}, {"_id": 0, "details": 1}):
        det = a.get("details") or {}
        if det.get("duplicate_admission_no") and det.get("surviving_admission_no"):
            surviving_of[imp.adm_norm(det["duplicate_admission_no"])] = imp.adm_norm(det["surviving_admission_no"])
    for adm in sorted(groups, key=lambda a: str(a)):
        grp = sorted(groups[adm], key=lambda r: (r["file"], r["row"]))
        existing = active_by_adm.get(adm, [])
        E = existing[0] if existing else None
        claimed = False
        for r in grp:
            k = key_of(r)
            if k in by_key:
                decisions.append({"kind": "existing_imported", "rec": r, "student": by_key[k], "adm": adm}); continue
            if E is None and adm in merged_by_adm and not claimed:
                # Number belongs to a record the office merged into another student (status 'duplicate').
                # The merge is kept: the Excel 2026-27 fee position is mapped to the ACTIVE surviving student.
                # No student is created or reactivated.
                surv_adm = surviving_of.get(adm)
                surv = active_by_adm.get(surv_adm, [None])[0] if surv_adm else None
                if surv is None:
                    decisions.append({"kind": "merged_hold", "rec": r, "adm": adm}); claimed = True
                    review.append({"file": r["file"], "row": r["row"], "excel_admission_no": adm, "name": r["name"], "label": r["label"],
                                   "reason": "HOLD - merged record without an identifiable active surviving student"})
                    continue
                decisions.append({"kind": "merged_map", "rec": r, "adm": adm, "student": surv})
                claimed = True
                review.append({"file": r["file"], "row": r["row"], "excel_admission_no": adm, "name": r["name"], "label": r["label"],
                               "reason": f"merged by office review into active {surv_adm}: 2026-27 fee position mapped to the active student; source number kept"})
                continue
            if E is not None and not claimed and name_matches(E["name"], r["name"]) and (len(grp) == 1 or
                    (E.get("class_id") == _cls(r, classes, depts) and (E.get("section") or "") == (_sec(r) or ""))):
                decisions.append({"kind": "update", "rec": r, "student": E, "adm": adm}); claimed = True; continue
            if E is None and not claimed and r is grp[0]:
                decisions.append({"kind": "create", "rec": r, "adm": adm, "new_adm": adm}); claimed = True
                assigned.add(adm)
                continue
            na = new_number(adm)
            decisions.append({"kind": "create", "rec": r, "adm": adm, "new_adm": na})
            review.append({"file": r["file"], "row": r["row"], "excel_admission_no": adm, "name": r["name"], "label": r["label"],
                           "assigned_admission_no": na, "reason": "shared/conflicting admission number - new unique number assigned" +
                           (" (existing FeeHub student keeps the number)" if E is not None else "")})

    out = []
    holds = [d for d in decisions if d["kind"] == "merged_hold"]
    for d in decisions:
        if d["kind"] == "merged_hold":
            continue
        r = d["rec"]
        mp = imp.map_label(r["label"])
        if not mp:
            raise SystemExit(f"unmapped label {r['label']} ({r['file']} row {r['row']})")
        dept_code, class_name, medium, stream, section = mp
        class_id, did = class_id_for(dept_code, class_name, medium, stream)
        if not class_id:
            raise SystemExit(f"no unique class for {dept_code}/{class_name}/{medium}/{stream}")
        fee, paid, bal = r["fee"], r["paid"], r["balance"]
        bus_stop, bus_issue = bus_for(r["bus"])
        mob = r["mobile"]
        if fee and fee > 0:
            fs = structure_for(class_id, medium, stream, r["status"], fee)
        else:
            fs = None
        d.update({"class_id": class_id, "dept_id": did, "medium": medium, "stream": stream, "section": section,
                  "fee": fee, "paid": paid, "balance": bal, "fs": fs, "bus_stop": bus_stop, "bus_issue": bus_issue,
                  "mobile": mob, "key": key_of(r), "excel": {k: r[k] for k in ("file", "row", "label", "fee", "paid", "balance", "bus", "type", "status", "mobile")}})
        out.append(d)
        if fee and fee > 0 and fs is None:
            review.append({"file": r["file"], "row": r["row"], "excel_admission_no": d["adm"], "name": r["name"], "label": r["label"],
                           "reason": f"fee {fee:,.0f} has no exact existing fee structure - FeeHub structure kept/none; Excel fee in fee_details"})
        if fee == 0:
            review.append({"file": r["file"], "row": r["row"], "excel_admission_no": d["adm"], "name": r["name"], "label": r["label"],
                           "reason": "Excel total fee 0 - existing FeeHub fee kept (or new student with zero fee)"})
        if r["bus"] and r["bus"].upper() not in ("NA", "NONE") and bus_stop is None:
            review.append({"file": r["file"], "row": r["row"], "excel_admission_no": d["adm"], "name": r["name"], "label": r["label"],
                           "reason": f"bus '{r['bus']}' {bus_issue} - bus left unchanged, raw value kept in source_bus_from"})
        if paid is not None and fee is not None and paid > fee + 0.5:
            review.append({"file": r["file"], "row": r["row"], "excel_admission_no": d["adm"], "name": r["name"], "label": r["label"],
                           "reason": "Excel paid is more than Excel fee - review"})
    return out, review, rec_total, fd_all, fee_by_id, class_by_id, holds


def _cls(r, classes, depts):
    mp = imp.map_label(r["label"])
    if not mp:
        return None
    cid, _ = (None, None)
    dept_code, class_name, medium, stream, section = mp
    did = depts.get(dept_code)
    hits = [c for c in classes if c.get("department_id") == did and c.get("name") == class_name and c.get("medium") == medium
            and (dept_code != "JC" or c.get("stream") == stream)]
    return hits[0]["id"] if len(hits) == 1 else None


def _sec(r):
    mp = imp.map_label(r["label"])
    return mp[4] if mp else None


def student_changes(s, d):
    ch = {}
    r = d["excel"]
    def set_(k, v):
        if s.get(k) != v:
            ch[k] = v
    set_("class_id", d["class_id"]); set_("department_id", d["dept_id"]); set_("section", d["section"])
    set_("medium", d["medium"]); set_("stream", d["stream"])
    if d["mobile"]:
        set_("guardian_mobile", d["mobile"])
    if r["type"]:
        set_("student_type", r["type"])
    if r["status"]:
        set_("enrollment_status", r["status"])
    if d["fs"] is not None:
        set_("fee_structure_id", d["fs"]["id"])
    if d["bus_stop"]:
        set_("bus_required", True); set_("bus_stop_no", d["bus_stop"]["stop_no"]); set_("bus_stop_name", d["bus_stop"].get("stop_name"))
        set_("bus_main_area", d["bus_stop"].get("main_area"))
    set_("source_admission_no", d["adm"])
    set_("source_bus_from", r["bus"] or None)
    set_("import_key", d["key"])
    return ch


def fee_doc(d, rec_sum, fd):
    """Returns (doc, note) for fee_details, or (None, note)."""
    fee, paid, bal = d["fee"], d["paid"], d["balance"]
    if fee is None:
        return None, "no fee"
    if fee == 0:
        if (paid or 0) > 0:
            return None, "zero Excel fee with Excel paid - not written, review"
        return None, "zero fee - existing fee kept"
    residual = round((paid or 0) - rec_sum, 2)
    if residual < -0.5:
        return None, "Excel paid below genuine receipts - not written, review"
    return {"total_fee": fee, "total_paid": max(residual, 0.0), "balance_fee": bal, "receipts": rec_sum}, None


def apply(db, out, rec_total, fd_all, fee_by_id, batch):
    stats = collections.Counter()
    for d in out:
        r = d["rec"]
        if d["kind"] == "create":
            if db.students.find_one({"import_key": d["key"]}):
                stats["already_imported"] += 1
                continue
            if db.students.find_one({"admission_no": d["new_adm"]}):
                raise SystemExit(f"admission {d['new_adm']} already exists - aborting to avoid duplicate")
            sid = str(uuid.uuid4())
            doc = {"id": sid, "admission_no": d["new_adm"], "name": r["name"], "department_id": d["dept_id"], "class_id": d["class_id"],
                   "section": d["section"], "medium": d["medium"], "stream": d["stream"],
                   "fee_structure_id": d["fs"]["id"] if d["fs"] else None,
                   "guardian_mobile": d["mobile"], "academic_year": ACADEMIC_YEAR, "status": "active",
                   "student_type": r["type"] or None, "enrollment_status": r["status"] or None,
                   "bus_required": bool(d["bus_stop"]), "bus_stop_no": d["bus_stop"]["stop_no"] if d["bus_stop"] else None,
                   "bus_stop_name": d["bus_stop"].get("stop_name") if d["bus_stop"] else None,
                   "bus_main_area": d["bus_stop"].get("main_area") if d["bus_stop"] else None,
                   "source_admission_no": d["adm"], "source_bus_from": r["bus"] or None, "import_key": d["key"],
                   "source_file": r["file"], "source_row": r["row"],
                   "father_name": None, "address": None, "roll_no": None, "version": 1,
                   "created_at": now_iso(), "imported_at": now_iso(), "imported_by": "excel-import-fy2026-corrected",
                   "import_batch_id": batch}
            db.students.insert_one(dict(doc))
            db.excel_import_audit.insert_one({"batch": batch, "action": "create_student", "student_id": sid,
                                              "admission_no": d["new_adm"], "source_admission_no": d["adm"],
                                              "after": {k: doc.get(k) for k in ("name", "class_id", "section", "medium", "stream", "fee_structure_id", "admission_no", "source_admission_no")},
                                              "excel": d["excel"], "at": now_iso()})
            stats["students_created"] += 1
            if d["new_adm"] != d["adm"]:
                stats["new_admission_numbers"] += 1
            sid_for_fee = sid
            cur_s = doc
        elif d["kind"] == "merged_map":
            cur_s = db.students.find_one({"id": d["student"]["id"]}, {"_id": 0})
            sid_for_fee = cur_s["id"]
            src = {"source_admission_no": d["adm"], "source_name": r["name"], "source_file": r["file"], "source_row": r["row"],
                   "source_label": r["label"], "note": "Excel row merged into this student by office review (2026-09-08)"}
            if not any(x.get("source_admission_no") == d["adm"] and x.get("source_row") == r["row"] and x.get("source_file") == r["file"]
                       for x in cur_s.get("merged_source_rows", [])):
                db.students.update_one({"id": cur_s["id"]}, {"$push": {"merged_source_rows": src}, "$set": {"import_batch_id_merged": batch}})
                db.excel_import_audit.insert_one({"batch": batch, "action": "merged_source_reference", "student_id": cur_s["id"],
                                                  "admission_no": cur_s.get("admission_no"), "after": src, "excel": d["excel"], "at": now_iso()})
                stats["merged_source_references"] += 1
        else:
            cur_s = db.students.find_one({"id": d["student"]["id"]}, {"_id": 0})
            sid_for_fee = cur_s["id"]
            if cur_s.get("import_batch_id") == batch:
                stats["already_applied"] += 1
            else:
                ch = student_changes(cur_s, d)
                if ch:
                    before = {k: cur_s.get(k) for k in ch}
                    upd = dict(ch); upd.update({"import_batch_id": batch, "imported_at": now_iso(),
                                                "version": int(cur_s.get("version") or 1) + 1})
                    db.students.update_one({"id": cur_s["id"]}, {"$set": upd})
                    db.excel_import_audit.insert_one({"batch": batch, "action": "update_student", "student_id": cur_s["id"],
                                                      "admission_no": cur_s.get("admission_no"), "before": before, "after": ch,
                                                      "excel": d["excel"], "at": now_iso()})
                    stats["students_updated"] += 1
                else:
                    db.students.update_one({"id": cur_s["id"]}, {"$set": {"import_batch_id": batch}})
                    stats["students_unchanged"] += 1
        # fee
        fd = db.fee_details.find_one({"student_id": sid_for_fee, "academic_year": ACADEMIC_YEAR}, {"_id": 0})
        if fd and fd.get("import_batch_id") == batch:
            continue
        if d["fee"] is None:
            continue
        if d["kind"] == "create" and d["fee"] == 0 and (d["paid"] or 0) == 0:
            # new zero-fee student: record the Excel position explicitly (zero), no invented fee
            doc = {"total_fee": 0.0, "total_paid": 0.0, "balance_fee": 0.0, "receipts": 0.0}
        else:
            doc, note = fee_doc(d, rec_total.get(sid_for_fee, 0.0), fd)
            if doc is None:
                stats["fee_not_written"] += 1
                continue
        fdset = {k: doc[k] for k in ("total_fee", "total_paid", "balance_fee")}
        fdset.update({"import_batch_id": batch, "source": "excel_import_fy2026", "updated_at": now_iso(),
                      "updated_by": "excel-import-fy2026-corrected"})
        if fd:
            db.fee_details.update_one({"student_id": sid_for_fee, "academic_year": ACADEMIC_YEAR}, {"$set": fdset})
        else:
            db.fee_details.insert_one({"id": str(uuid.uuid4()), "student_id": sid_for_fee, "academic_year": ACADEMIC_YEAR,
                                       "admission_no": cur_s.get("admission_no"), "created_at": now_iso(),
                                       "created_by": "excel-import-fy2026-corrected",
                                       "remarks": "Opening paid from Excel FY2026-27 import (no receipts created)", **fdset})
        db.excel_import_audit.insert_one({"batch": batch, "action": "fee_details", "student_id": sid_for_fee,
                                          "admission_no": cur_s.get("admission_no"),
                                          "before": {k: (fd or {}).get(k) for k in ("total_fee", "total_paid", "balance_fee")} if fd else None,
                                          "after": fdset, "at": now_iso()})
        stats["fee_records_written"] += 1
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel-dir", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    env = {}
    for line in open(ENV_FILE, encoding="utf-8-sig"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); env[k] = v
    db = MongoClient(env["MONGO_URL"], serverSelectionTimeoutMS=8000)[a.db]
    files, summary, raw = imp.read_excel(a.excel_dir)
    out, review, rec_total, fd_all, fee_by_id, class_by_id, holds = build(db, raw)
    os.makedirs(a.out, exist_ok=True)
    kinds = collections.Counter(d["kind"] for d in out)
    recon = {"holds_not_imported": len(holds), "hold_records": [(h["rec"]["file"], h["rec"]["row"], h["adm"], h["rec"]["name"]) for h in holds],
             "files": len(files), "summary_rows_ignored": len(summary), "valid_student_rows": len(raw),
             "identical_cross_file_duplicates": len(raw) - len(imp.dedupe(raw)), "distinct_student_records": len(out),
             "plan": dict(kinds), "review_items": len(review), "database": a.db, "batch": BATCH,
             "generated_at": now_iso()}
    json.dump({"reconciliation": recon, "review": review}, open(os.path.join(a.out, "plan-v2.json"), "w", encoding="utf-8"), default=str, indent=1)
    print(json.dumps(recon, indent=1))
    if a.apply:
        if db.students.count_documents({}) < 1000:
            sys.exit("refusing: database does not look like the FeeHub student database")
        stats = apply(db, out, rec_total, fd_all, fee_by_id, BATCH)
        db.excel_import_audit.insert_one({"batch": BATCH, "action": "batch_summary", "stats": dict(stats), "at": now_iso()})
        json.dump({"stats": dict(stats)}, open(os.path.join(a.out, "apply-v2-stats.json"), "w"), indent=1)
        print("APPLIED", dict(stats))


if __name__ == "__main__":
    main()
