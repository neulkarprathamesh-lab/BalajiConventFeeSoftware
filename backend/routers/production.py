"""Production data purge — wipes all transactional data while preserving
every piece of master/configuration data. Callable both via HTTP
(`POST /api/production/purge`) and via CLI (`python -m scripts.production_purge`).

Preserved (master data):
    departments, classes, fee_heads, fee_structures, receipt_types,
    bus_stops, bus_routes, users, settings, config_defaults

Deleted (transactional data):
    students, receipts, vouchers (all rows in receipts collection),
    adjustments, payment_extensions, reminders, notices, audit_log,
    config_snapshots, updates, backups (records only — ZIP files on disk
    kept unless `also_clear_backup_files=true`), staged updates on disk,
    every counter is reset to 0 so numbering restarts.

Every purge action is atomic per-collection; if a delete fails half-way the
result document reports exactly what was and was not cleared so the admin
can retry.
"""
from __future__ import annotations
from typing import Any, Dict, List
from datetime import datetime, timezone
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel

from core import db, audit, now_iso, require_admin_pin, gen_id, APP_ROOT

router = APIRouter(prefix="/api/production", tags=["production"])

# Every transactional collection we know about.
TRANSACTIONAL_COLLECTIONS: List[str] = [
    "students",
    "receipts",
    "adjustments",
    "payment_extensions",
    "reminders",
    "notices",
    "audit_log",
    "config_snapshots",
    "updates",
    "backups",
    "diagnostics_snapshots",
]

MASTER_COLLECTIONS: List[str] = [
    "departments", "classes", "fee_heads", "fee_structures",
    "receipt_types", "bus_stops", "bus_routes", "users",
    "settings", "config_defaults",
]

STAGING_DIRS = [
    APP_ROOT / "updates" / "staging",
    APP_ROOT / "updates" / "rollback",
]
BACKUPS_DIR = APP_ROOT / "backups"

# ---------------- Factory Reset (destructive, admin-only) ----------------
DEFAULT_FACTORY_PIN = "2580"

# Everything a Factory Reset touches:
#   • DELETED (superset of the purge): every transactional collection + every
#     non-administrator user + receipt counters + uploaded attachments + tmp.
#   • PRESERVED: administrator user(s), settings (school info, logo, printer),
#     departments, classes, fee_heads, fee_structures, receipt_types,
#     bus_routes, bus_stops, license/ownership.
FACTORY_DELETE_COLLECTIONS: List[str] = [
    "students", "receipts", "adjustments", "payment_extensions",
    "reminders", "notices", "audit_log", "config_snapshots",
    "updates", "backups", "diagnostics_snapshots",
    "imports_history", "attachments",
]
FACTORY_PRESERVE_COLLECTIONS: List[str] = [
    "settings", "departments", "classes", "fee_heads", "fee_structures",
    "receipt_types", "bus_stops", "bus_routes", "config_defaults",
    "license",
]


async def _get_factory_pin() -> str:
    doc = await db.settings.find_one({"key": "factory_reset_pin"})
    return (doc or {}).get("value", DEFAULT_FACTORY_PIN)


async def _set_factory_pin(new_pin: str) -> None:
    if not (new_pin and new_pin.isdigit() and 4 <= len(new_pin) <= 8):
        raise HTTPException(400, "Factory PIN must be 4–8 digits.")
    await db.settings.update_one(
        {"key": "factory_reset_pin"},
        {"$set": {"key": "factory_reset_pin", "value": new_pin, "updated_at": now_iso()}},
        upsert=True,
    )


class FactoryPinIn(BaseModel):
    current_password: str
    new_pin: str


@router.get("/factory-reset/status")
async def factory_reset_status(user = Depends(require_admin_pin)):
    """Returns whether the factory PIN is still at its default (2580) and what
    a factory reset would delete/preserve — never leaks the actual PIN."""
    pin = await _get_factory_pin()
    admin_users = await db.users.count_documents({"role": "administrator"})
    non_admin_users = await db.users.count_documents({"role": {"$ne": "administrator"}})
    tx_counts, master_counts = {}, {}
    for c in FACTORY_DELETE_COLLECTIONS:
        try: tx_counts[c] = await db[c].count_documents({})
        except Exception: tx_counts[c] = 0
    for c in FACTORY_PRESERVE_COLLECTIONS:
        try: master_counts[c] = await db[c].count_documents({})
        except Exception: master_counts[c] = 0
    return {
        "is_default_pin": pin == DEFAULT_FACTORY_PIN,
        "default_pin_hint": DEFAULT_FACTORY_PIN if pin == DEFAULT_FACTORY_PIN else None,
        "admin_users_preserved": admin_users,
        "non_admin_users_will_be_deleted": non_admin_users,
        "will_delete": tx_counts,
        "will_preserve": master_counts,
        "confirm_phrase_required": "DELETE ALL SCHOOL DATA",
    }


@router.post("/factory-reset/change-pin")
async def factory_reset_change_pin(body: FactoryPinIn, user = Depends(require_admin_pin)):
    # Re-verify password (bcrypt) before allowing PIN change
    from core import verify_password
    u = await db.users.find_one({"id": user["id"]})
    if not u or not verify_password(body.current_password, u.get("password_hash", "")):
        raise HTTPException(401, "Current password is incorrect.")
    await _set_factory_pin(body.new_pin)
    await audit(user, "factory_reset_pin_changed", "system", "factory_pin", {"is_default": body.new_pin == DEFAULT_FACTORY_PIN})
    return {"ok": True, "is_default_pin": body.new_pin == DEFAULT_FACTORY_PIN}


class FactoryResetIn(BaseModel):
    current_password: str
    factory_pin: str
    confirm_phrase: str


@router.post("/factory-reset")
async def factory_reset(body: FactoryResetIn, user = Depends(require_admin_pin)):
    """5-gate security: role=administrator + X-Admin-Pin + Password re-verify +
    Factory PIN + Confirmation phrase. Then: auto-backup → snapshot →
    delete transactional + non-admin users + counters + attachments → audit."""
    # 1) Password re-verify
    from core import verify_password
    u = await db.users.find_one({"id": user["id"]})
    if not u or not verify_password(body.current_password, u.get("password_hash", "")):
        raise HTTPException(401, "Administrator password is incorrect.")

    # 2) Factory PIN match
    expected_pin = await _get_factory_pin()
    if body.factory_pin != expected_pin:
        raise HTTPException(401, "Factory Reset PIN is incorrect.")

    # 3) Confirmation phrase EXACT
    if body.confirm_phrase != "DELETE ALL SCHOOL DATA":
        raise HTTPException(400, 'Confirmation phrase must be exactly: "DELETE ALL SCHOOL DATA"')

    log: Dict[str, Any] = {"steps": []}
    def step(name: str, ok: bool, msg: str = "", **extra):
        log["steps"].append({"name": name, "ok": ok, "message": msg, **extra})

    started = now_iso()

    # 4) MANDATORY database backup (abort factory reset if this fails)
    from core import _create_backup_zip
    try:
        backup = await _create_backup_zip("factory-reset", user["name"])
        step("db_backup", True, f"{backup['filename']}", backup_id=backup["id"])
    except Exception as e:
        step("db_backup", False, str(e))
        raise HTTPException(500, f"Factory reset aborted — database backup failed: {e}")

    # 5) Config snapshot (best-effort)
    try:
        from routers.snapshots import _dump_config_now
        snap_data = await _dump_config_now()
        counts = {k: len(v) for k, v in snap_data.items()}
        sid = gen_id()
        await db.config_snapshots.insert_one({
            "id": sid, "academic_year": "factory-reset",
            "label": f"Pre-factory-reset {started}",
            "counts": counts, "total_records": sum(counts.values()),
            "created_at": started, "created_by": user["name"],
            "notes": "Automatic snapshot taken immediately before Factory Reset.",
            "data": snap_data,
        })
        step("config_snapshot", True, f"{sum(counts.values())} rows archived", snapshot_id=sid)
    except Exception as e:
        step("config_snapshot", False, str(e))

    # 6) Delete every transactional collection
    deleted: Dict[str, int] = {}
    for coll in FACTORY_DELETE_COLLECTIONS:
        try:
            r = await db[coll].delete_many({})
            deleted[coll] = r.deleted_count
        except Exception as e:
            deleted[coll] = -1
            step(f"delete:{coll}", False, str(e))
    step("delete_transactional", True, f"{sum(v for v in deleted.values() if v>0)} row(s) deleted across {len(FACTORY_DELETE_COLLECTIONS)} collection(s)")

    # 7) Delete non-administrator users
    try:
        r = await db.users.delete_many({"role": {"$ne": "administrator"}})
        step("delete_non_admin_users", True, f"{r.deleted_count} non-admin user(s) removed")
        deleted["users_non_admin"] = r.deleted_count
    except Exception as e:
        step("delete_non_admin_users", False, str(e))

    # 8) Reset receipt / voucher counters
    try:
        cr = await db.counters.delete_many({})
        step("counters_reset", True, f"{cr.deleted_count} counter(s) reset — numbering restarts from 1")
    except Exception as e:
        step("counters_reset", False, str(e))

    # 9) Clear staging & rollback directories
    for d in STAGING_DIRS:
        if d.exists():
            try:
                for child in d.iterdir():
                    if child.is_dir(): shutil.rmtree(child, ignore_errors=True)
                    else: child.unlink(missing_ok=True)
                step(f"clear:{d.name}", True, f"cleared {d}")
            except Exception as e:
                step(f"clear:{d.name}", False, str(e))

    completed = now_iso()

    # 10) Audit — the FIRST entry of the freshly reset database.
    try:
        await audit(user, "factory_reset", "system", "factory_reset", {
            "started_at": started, "completed_at": completed,
            "backup_id": backup["id"], "backup_file": backup["filename"],
            "deleted_counts": deleted,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "started_at": started,
        "completed_at": completed,
        "backup_id": backup["id"],
        "backup_file": backup["filename"],
        "deleted": deleted,
        "administrator_preserved": user["name"],
        "log": log,
    }


class PurgeIn(BaseModel):
    confirm_phrase: str
    also_clear_backup_files: bool = False
    also_clear_staged_updates: bool = True


@router.post("/purge")
async def purge(
    body: PurgeIn = Body(...),
    user = Depends(require_admin_pin),
):
    """Requires Administrator PIN AND the exact phrase "PURGE DEMO DATA"."""
    if body.confirm_phrase != "PURGE DEMO DATA":
        raise HTTPException(400, 'Confirmation phrase must be exactly: "PURGE DEMO DATA"')

    result: Dict[str, Any] = {
        "started_at": now_iso(),
        "collections_deleted": {},
        "counters_reset": 0,
        "master_data_preserved": {},
        "disk_actions": [],
    }

    # 1) Delete every transactional collection
    for coll in TRANSACTIONAL_COLLECTIONS:
        try:
            r = await db[coll].delete_many({})
            result["collections_deleted"][coll] = r.deleted_count
        except Exception as e:
            result["collections_deleted"][coll] = f"ERROR: {e}"

    # 2) Count master data (for confidence in the report)
    for coll in MASTER_COLLECTIONS:
        try:
            result["master_data_preserved"][coll] = await db[coll].count_documents({})
        except Exception as e:
            result["master_data_preserved"][coll] = f"ERROR: {e}"

    # 3) Reset receipt / voucher / snapshot / adm-no counters
    try:
        cr = await db.counters.delete_many({})
        result["counters_reset"] = cr.deleted_count
    except Exception as e:
        result["counters_reset"] = f"ERROR: {e}"

    # 4) Optional disk clean-up
    if body.also_clear_staged_updates:
        for d in STAGING_DIRS:
            if d.exists():
                try:
                    for child in d.iterdir():
                        if child.is_dir(): shutil.rmtree(child, ignore_errors=True)
                        else: child.unlink(missing_ok=True)
                    result["disk_actions"].append(f"cleared {d}")
                except Exception as e:
                    result["disk_actions"].append(f"ERROR clearing {d}: {e}")

    if body.also_clear_backup_files and BACKUPS_DIR.exists():
        try:
            removed = 0
            for f in BACKUPS_DIR.glob("*.zip"):
                f.unlink(); removed += 1
            result["disk_actions"].append(f"deleted {removed} backup zip(s)")
        except Exception as e:
            result["disk_actions"].append(f"ERROR clearing backup files: {e}")

    result["completed_at"] = now_iso()

    # 5) Audit — first entry of the fresh production database
    try:
        await audit(user, "production_purge", "system", "purge", {
            "collections_deleted": result["collections_deleted"],
            "counters_reset": result["counters_reset"],
            "also_clear_backup_files": body.also_clear_backup_files,
        })
    except Exception:
        pass

    return result


@router.get("/purge/preview")
async def purge_preview(user = Depends(require_admin_pin)):
    """Read-only counts of what a purge WOULD delete vs. preserve."""
    tx = {}
    for coll in TRANSACTIONAL_COLLECTIONS:
        try:
            tx[coll] = await db[coll].count_documents({})
        except Exception as e:
            tx[coll] = f"ERROR: {e}"
    master = {}
    for coll in MASTER_COLLECTIONS:
        try:
            master[coll] = await db[coll].count_documents({})
        except Exception as e:
            master[coll] = f"ERROR: {e}"
    try:
        counter_count = await db.counters.count_documents({})
    except Exception as e:
        counter_count = f"ERROR: {e}"
    return {
        "would_delete": tx,
        "would_reset_counters": counter_count,
        "would_preserve": master,
        "confirm_phrase_required": "PURGE DEMO DATA",
    }
