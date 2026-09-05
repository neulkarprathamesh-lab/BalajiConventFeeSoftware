"""Configuration Snapshots — per academic year config archive with compare + restore.
Independent of the daily-ops backup: this captures ONLY the school configuration
so admins can see how fees / departments / receipt types evolved year over year."""
import io
import json as _json
import zipfile
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import StreamingResponse
from core import (
    db, CONFIG_COLLECTIONS, audit, gen_id, get_current_user, now_iso,
    require_admin_pin, require_admin_dual,
)

router = APIRouter(prefix="/api", tags=["snapshots"])

SNAPSHOT_COLLECTIONS = CONFIG_COLLECTIONS + ["bus_stops"]


async def _dump_config_now() -> Dict[str, List[dict]]:
    payload: Dict[str, List[dict]] = {}
    for coll in SNAPSHOT_COLLECTIONS:
        payload[coll] = await db[coll].find({}, {"_id": 0}).to_list(20000)
    return payload


@router.get("/snapshots")
async def list_snapshots(user = Depends(get_current_user)):
    docs = await db.config_snapshots.find({}, {"_id": 0, "data": 0}).sort("created_at", -1).to_list(200)
    return docs


@router.post("/snapshots")
async def create_snapshot(body: Dict[str, Any], user = Depends(require_admin_pin)):
    ay = str(body.get("academic_year") or "").strip()
    if not ay:
        raise HTTPException(400, "academic_year is required (e.g. 2026-27)")
    label = str(body.get("label") or f"End of {ay}").strip()
    data = await _dump_config_now()
    counts = {k: len(v) for k, v in data.items()}
    total = sum(counts.values())
    sid = gen_id()
    doc = {
        "id": sid, "academic_year": ay, "label": label,
        "counts": counts, "total_records": total,
        "created_at": now_iso(), "created_by": user["name"],
        "notes": str(body.get("notes") or "").strip() or None,
        "data": data,
    }
    await db.config_snapshots.insert_one(dict(doc))
    await audit(user, "snapshot_create", "config_snapshot", sid, {"ay": ay, "total": total})
    return {k: v for k, v in doc.items() if k not in ("data", "_id")}


@router.get("/snapshots/{sid}")
async def get_snapshot(sid: str, include_data: bool = False, user = Depends(get_current_user)):
    proj = {"_id": 0}
    if not include_data:
        proj["data"] = 0
    doc = await db.config_snapshots.find_one({"id": sid}, proj)
    if not doc:
        raise HTTPException(404, "Snapshot not found")
    return doc


@router.get("/snapshots/{sid}/export")
async def export_snapshot(sid: str, user = Depends(require_admin_pin)):
    doc = await db.config_snapshots.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Snapshot not found")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {"id": doc["id"], "academic_year": doc["academic_year"], "label": doc["label"],
                    "created_at": doc["created_at"], "created_by": doc["created_by"],
                    "counts": doc["counts"], "total_records": doc["total_records"],
                    "app_version": "1.0.0"}
        zf.writestr("manifest.json", _json.dumps(manifest, indent=2, default=str))
        for coll, rows in (doc.get("data") or {}).items():
            zf.writestr(f"{coll}.json", _json.dumps(rows, indent=2, default=str))
    buf.seek(0)
    await audit(user, "snapshot_export", "config_snapshot", sid, {"ay": doc["academic_year"]})
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="config-snapshot-{doc["academic_year"]}-{doc["id"][:8]}.zip"'},
    )


@router.get("/snapshots/{a}/compare/{b}")
async def compare_snapshots(a: str, b: str, user = Depends(get_current_user)):
    """Side-by-side counts + a shallow field-level diff by `id` per collection."""
    doc_a = await db.config_snapshots.find_one({"id": a}, {"_id": 0})
    doc_b = await db.config_snapshots.find_one({"id": b}, {"_id": 0})
    if not doc_a or not doc_b:
        raise HTTPException(404, "One of the snapshots was not found")
    per_coll = []
    for coll in SNAPSHOT_COLLECTIONS:
        ra = (doc_a.get("data") or {}).get(coll, [])
        rb = (doc_b.get("data") or {}).get(coll, [])
        by_id_a = {r.get("id"): r for r in ra if r.get("id")}
        by_id_b = {r.get("id"): r for r in rb if r.get("id")}
        added   = [b for k, b in by_id_b.items() if k not in by_id_a]
        removed = [a for k, a in by_id_a.items() if k not in by_id_b]
        changed = []
        for k, va in by_id_a.items():
            vb = by_id_b.get(k)
            if not vb: continue
            fields = [f for f in set(list(va.keys()) + list(vb.keys())) if va.get(f) != vb.get(f) and f not in ("_id","created_at","updated_at")]
            if fields:
                changed.append({"id": k, "name": va.get("name") or va.get("stop_name") or va.get("code") or k[:8], "changed_fields": fields})
        per_coll.append({"collection": coll, "count_a": len(ra), "count_b": len(rb),
                         "added": len(added), "removed": len(removed), "changed": len(changed),
                         "changed_rows": changed[:20]})
    return {
        "a": {k: v for k, v in doc_a.items() if k != "data"},
        "b": {k: v for k, v in doc_b.items() if k != "data"},
        "per_collection": per_coll,
    }


@router.post("/snapshots/{sid}/restore")
async def restore_snapshot(sid: str, user = Depends(require_admin_dual)):
    """DUAL-AUTH — replaces every configuration collection with the snapshot's contents.
    Historical students, receipts, adjustments, extensions are untouched."""
    doc = await db.config_snapshots.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Snapshot not found")
    data = doc.get("data") or {}
    summary: Dict[str, int] = {}
    for coll, rows in data.items():
        if coll not in SNAPSHOT_COLLECTIONS: continue
        await db[coll].delete_many({})
        if rows:
            await db[coll].insert_many([dict(r) for r in rows])
        summary[coll] = len(rows)
    await audit(user, "snapshot_restore", "config_snapshot", sid, {"ay": doc["academic_year"], "summary": summary})
    return {"restored": True, "academic_year": doc["academic_year"], "summary": summary}


@router.delete("/snapshots/{sid}")
async def delete_snapshot(sid: str, user = Depends(require_admin_pin)):
    doc = await db.config_snapshots.find_one({"id": sid})
    if not doc:
        raise HTTPException(404, "Snapshot not found")
    await db.config_snapshots.delete_one({"id": sid})
    await audit(user, "snapshot_delete", "config_snapshot", sid)
    return {"deleted": True}
