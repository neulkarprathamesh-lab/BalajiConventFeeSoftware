"""READ-ONLY verification of the FY2026-27 Excel import: every distinct Excel student represented, fee/paid match, receipts count.
Usage: python scripts/verify_excel_import.py <database name> <output json>"""
import sys, json, collections
sys.path.insert(0, r"C:\balaji-fee\03-source-code\backend\scripts")
import import_excel_fy2026 as imp, import_excel_fy2026_v2 as v2
from pymongo import MongoClient
DBN = sys.argv[1]; OUT = sys.argv[2]
env = {}
for l in open(r"C:\balaji-fee\backend\.env", encoding="utf-8-sig"):
    l = l.strip()
    if "=" in l and not l.startswith("#"): k, v = l.split("=", 1); env[k] = v
db = MongoClient(env["MONGO_URL"], serverSelectionTimeoutMS=8000)[DBN]
files, summ, raw = imp.read_excel(r"D:\fee software\Fees\Fee hub 26-27 All Class")
recs = imp.dedupe(raw)
rec_total = collections.defaultdict(float)
for r in db.receipts.find({"status": {"$ne": "cancelled"}}, {"_id": 0, "student_id": 1, "total": 1}):
    rec_total[r["student_id"]] += float(r.get("total") or 0)
fs = {f["id"]: f for f in db.fee_structures.find({}, {"_id": 0})}
by_key = {s.get("import_key"): s for s in db.students.find({"import_key": {"$exists": True}}, {"_id": 0})}
res = collections.Counter(); missing = []; mism = []
for r in recs:
    st = by_key.get(v2.key_of(r))
    if st is None:
        # match by original number + name for records already in FeeHub before the corrected import
        cands = [s for s in db.students.find({"$or": [{"admission_no": r["adm"]}, {"source_admission_no": r["adm"]}]}, {"_id": 0})
                 if imp.name_key(s["name"]) == imp.name_key(r["name"]) and s.get("status") != "duplicate"]
        st = cands[0] if cands else None
    if st is None:
        st = db.students.find_one({"merged_source_rows": {"$elemMatch": {"source_admission_no": r["adm"], "source_row": r["row"], "source_file": r["file"]}}}, {"_id": 0})
        if st is not None:
            res["represented via merge (active surviving student)"] += 1
            continue
    if st is None:
        res["NOT REPRESENTED"] += 1; missing.append((r["file"], r["row"], r["adm"], r["name"], r["label"])); continue
    res["represented"] += 1
    total = float((fs.get(st.get("fee_structure_id")) or {}).get("total") or 0)
    fd = db.fee_details.find_one({"student_id": st["id"], "academic_year": "2026-27"}, {"_id": 0}) or {}
    paid = rec_total.get(st["id"], 0.0) + float(fd.get("total_paid") or 0)
    bal = total - paid
    if fd or r["fee"] > 0:
        ok = abs(paid - r["paid"]) < 0.5
        res["paid equal" if ok else "paid differs"] += 1
        if not ok: mism.append(("paid", r["adm"], r["name"], r["paid"], paid))
        if r["fee"] > 0:
            okf = abs(total - r["fee"]) < 0.5
            res["fee equal" if okf else "fee differs (kept FeeHub structure)"] += 1
    if r["fee"] == 0:
        res["zero-fee Excel: FeeHub fee kept"] += 1
out = {"distinct_excel_students": len(recs), "result": dict(res), "not_represented": missing, "paid_mismatches": mism,
       "students_total": db.students.count_documents({}), "receipts": db.receipts.count_documents({}),
       "receipt_total": round(sum(float(r.get("total") or 0) for r in db.receipts.find({}, {"total": 1})), 2)}
json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if k not in ("not_represented", "paid_mismatches")}, indent=1, default=str))
print("not represented:", missing)
