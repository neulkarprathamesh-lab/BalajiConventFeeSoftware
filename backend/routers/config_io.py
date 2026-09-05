"""Config export/import + Database Backups (PIN-gated / dual-auth)."""
import io, zipfile, json as _json
from datetime import date
from pathlib import Path
from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from starlette.responses import StreamingResponse
from core import (
    db, CONFIG_COLLECTIONS, audit, gen_id, hash_password, now_iso,
    require_admin_pin, require_admin_dual, require_roles, _create_backup_zip,
)

router = APIRouter(prefix="/api", tags=["config_io"])

@router.post("/config/backup")
async def create_manual_backup(user = Depends(require_admin_pin)):
    m = await _create_backup_zip("manual", user["name"])
    await audit(user, "backup_create", "system", m["id"], {"kind": m["kind"], "size": m["size"], "rotated_out": m.get("rotated_out", [])})
    return {k:v for k,v in m.items() if k != "_id"}

@router.get("/config/backups")
async def list_backups(limit: int = 50, user = Depends(require_roles("administrator"))):
    return await db.backups.find({}, {"_id":0}).sort("created_at", -1).limit(limit).to_list(limit)

@router.get("/config/backups/{bid}/download")
async def download_backup(bid: str, user = Depends(require_admin_pin)):
    doc = await db.backups.find_one({"id": bid}, {"_id":0})
    if not doc: raise HTTPException(404, "Backup not found")
    p = Path(doc["path"])
    if not p.exists(): raise HTTPException(410, "Backup file missing on disk")
    await audit(user, "backup_download", "system", bid, {"filename": doc["filename"]})
    return StreamingResponse(open(p, "rb"), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{doc["filename"]}"'})

@router.get("/config/export")
async def export_config(user = Depends(require_admin_pin)):
    """Export school configuration as a ZIP (JSON per collection). Passwords & PINs are stripped from users."""
    buf = io.BytesIO()
    manifest = {"exported_at": now_iso(), "exported_by": user["name"], "app_version": "1.0.0", "collections": []}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for coll in CONFIG_COLLECTIONS:
            rows = await db[coll].find({}, {"_id":0}).to_list(20000)
            zf.writestr(f"{coll}.json", _json.dumps(rows, indent=2, default=str))
            manifest["collections"].append({"name": coll, "count": len(rows)})
        users = await db.users.find({}, {"_id":0, "password_hash":0, "pin_hash":0}).to_list(500)
        zf.writestr("users.json", _json.dumps(users, indent=2, default=str))
        manifest["collections"].append({"name": "users", "count": len(users), "notes": "password/pin stripped"})
        zf.writestr("manifest.json", _json.dumps(manifest, indent=2))
        readme = ("# Balaji Fee Software — Configuration Export\n\n"
                  f"Exported: {manifest['exported_at']}\nBy: {manifest['exported_by']}\n\n"
                  "Import this ZIP into another school PC via Administration → Config Import.\n"
                  "Users are exported WITHOUT passwords/PINs — you must reset them after import.\n")
        zf.writestr("README.md", readme)
    buf.seek(0)
    await audit(user, "config_export", "system", "", {"collections": [c["name"] for c in manifest["collections"]]})
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="balaji-config-{date.today().isoformat()}.zip"'}
    )

@router.post("/config/import")
async def import_config(
    replace: bool = False,
    file: UploadFile = File(...),
    user = Depends(require_admin_dual),
):
    """Restore collections from a config ZIP. replace=false upserts by id; replace=true drops+inserts each collection."""
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content), "r")
    except zipfile.BadZipFile:
        raise HTTPException(400, "Not a valid ZIP")
    names = set(zf.namelist())
    if "manifest.json" not in names:
        raise HTTPException(400, "manifest.json missing — this is not a Balaji config ZIP")
    manifest = _json.loads(zf.read("manifest.json").decode())
    pre_backup = None
    if replace:
        try:
            pre_backup = await _create_backup_zip("pre-import", user["name"])
            await audit(user, "backup_auto", "system", pre_backup["id"], {"reason": "pre_import_replace", "size": pre_backup["size"]})
        except Exception as e:
            raise HTTPException(500, f"Pre-import backup failed — refusing to proceed: {e}")
    summary: Dict[str, Any] = {"imported": {}, "pre_backup": pre_backup}
    for coll in CONFIG_COLLECTIONS + ["users"]:
        fn = f"{coll}.json"
        if fn not in names: continue
        rows = _json.loads(zf.read(fn).decode() or "[]")
        if replace:
            await db[coll].delete_many({})
        added = updated = 0
        for r in rows:
            if not isinstance(r, dict) or not r.get("id"):
                continue
            if coll == "users":
                if await db.users.find_one({"id": r["id"]}):
                    continue
                r["password_hash"] = hash_password(gen_id()[:12])
                r["pin_hash"] = None
                await db.users.insert_one(r); added += 1; continue
            existing = await db[coll].find_one({"id": r["id"]})
            if existing:
                await db[coll].update_one({"id": r["id"]}, {"$set": r}); updated += 1
            else:
                await db[coll].insert_one(r); added += 1
        summary["imported"][coll] = {"added": added, "updated": updated, "total_in_file": len(rows)}
    await audit(user, "config_import", "system", "", {"replace": replace, "summary": summary, "manifest": manifest})
    return {"ok": True, "replace_mode": replace, "manifest": manifest, "summary": summary}
