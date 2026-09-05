"""System Diagnostics — server-side checks + daily 8 AM snapshot + onboarding flag."""
import asyncio
import os
import shutil
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from core import (
    db, client, get_current_user, now_iso, BACKUP_DIR, APP_ROOT,
    get_settings_doc, SETTINGS_ID, require_roles, audit,
)

router = APIRouter(prefix="/api", tags=["diagnostics"])

APP_VERSION = "1.0.0"
DATABASE_VERSION = "1"
DAILY_SNAPSHOT_HOUR = 8   # server-local 8 AM


def _check(name: str, ok: bool, message: str, details: Dict[str, Any] = None) -> Dict[str, Any]:
    return {"name": name, "ok": ok, "status": "ok" if ok else "fail", "message": message, "details": details or {}}


async def _run_server_side_checks() -> List[Dict[str, Any]]:
    """Runs the six server-side checks. Callable from HTTP endpoint AND background scheduler."""
    checks: List[Dict[str, Any]] = []

    try:
        t0 = time.perf_counter()
        pong = await client.admin.command("ping")
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        checks.append(_check(
            "Database connection", bool(pong.get("ok")),
            f"MongoDB responded to ping in {latency_ms} ms",
            {"latency_ms": latency_ms, "database": db.name},
        ))
    except Exception as e:
        checks.append(_check("Database connection", False, f"Cannot reach MongoDB: {e}"))

    try:
        info = await client.admin.command("buildInfo")
        mongo_version = info.get("version", "unknown")
        collections = await db.list_collection_names()
        checks.append(_check(
            "Database version", True,
            f"MongoDB {mongo_version}, schema v{DATABASE_VERSION}, {len(collections)} collections",
            {"mongo_version": mongo_version, "schema_version": DATABASE_VERSION,
             "collections_count": len(collections)},
        ))
    except Exception as e:
        checks.append(_check("Database version", False, f"Cannot read database version: {e}"))

    checks.append(_check(
        "Software version", True,
        f"Balaji Convent Fee Software v{APP_VERSION}",
        {"app_version": APP_VERSION, "build_date": "2026-02-04"},
    ))

    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        test_file = BACKUP_DIR / ".diag_write_test"
        test_file.write_text("ok")
        test_file.unlink()
        backups = sorted(BACKUP_DIR.glob("*.zip"))
        latest = backups[-1].name if backups else None
        checks.append(_check(
            "Backup folder access", True,
            f"Writable — {len(backups)} backup(s) on disk"
            + (f", latest: {latest}" if latest else ", no backups yet"),
            {"path": str(BACKUP_DIR), "backups_count": len(backups), "latest_backup": latest},
        ))
    except PermissionError as e:
        checks.append(_check("Backup folder access", False,
            f"Backup folder is not writable: {BACKUP_DIR} — {e}",
            {"path": str(BACKUP_DIR)}))
    except Exception as e:
        checks.append(_check("Backup folder access", False,
            f"Backup folder not found or inaccessible: {e}",
            {"path": str(BACKUP_DIR)}))

    try:
        target = BACKUP_DIR if BACKUP_DIR.exists() else APP_ROOT
        total, used, free = shutil.disk_usage(target)
        gb = 1024 ** 3
        free_gb = round(free / gb, 2)
        used_pct = round((used / total) * 100, 1) if total else 0
        low = free_gb < 2
        checks.append(_check(
            "Storage space", not low,
            f"{free_gb} GB free ({used_pct}% used)" + (" — LOW, keep at least 2 GB free" if low else ""),
            {"free_gb": free_gb, "total_gb": round(total/gb, 2), "used_percent": used_pct,
             "path": str(target)},
        ))
    except Exception as e:
        checks.append(_check("Storage space", False, f"Cannot read disk usage: {e}"))

    try:
        users_count = await db.users.count_documents({})
        students_count = await db.students.count_documents({})
        receipts_count = await db.receipts.count_documents({})
        rtypes_count = await db.receipt_types.count_documents({})
        ok = users_count > 0 and rtypes_count > 0
        checks.append(_check(
            "Seed data", ok,
            f"{users_count} users · {students_count} students · {receipts_count} receipts · {rtypes_count} receipt types"
            + ("" if ok else " — seed missing"),
            {"users": users_count, "students": students_count, "receipts": receipts_count,
             "receipt_types": rtypes_count},
        ))
    except Exception as e:
        checks.append(_check("Seed data", False, f"Cannot read collections: {e}"))

    return checks


async def _snapshot_diagnostics(source: str, actor_name: str = "scheduler") -> Dict[str, Any]:
    """Runs the server checks and persists a snapshot in `diagnostic_reports`. Retains last 60 snapshots."""
    checks = await _run_server_side_checks()
    overall_ok = all(c["ok"] for c in checks)
    failing = [c["name"] for c in checks if not c["ok"]]
    doc = {
        "id": f"diag-{int(time.time()*1000)}",
        "source": source,   # "scheduler" | "manual"
        "actor": actor_name,
        "created_at": now_iso(),
        "overall_ok": overall_ok,
        "failing": failing,
        "checks": checks,
        "app_version": APP_VERSION,
        "database_version": DATABASE_VERSION,
    }
    await db.diagnostic_reports.insert_one(dict(doc))
    # Retain only the most-recent 60 snapshots
    all_ids = await db.diagnostic_reports.find({}, {"id": 1, "_id": 0}).sort("created_at", -1).to_list(1000)
    stale = [x["id"] for x in all_ids[60:]]
    if stale:
        await db.diagnostic_reports.delete_many({"id": {"$in": stale}})
    return {k: v for k, v in doc.items() if k != "_id"}


# ---------------- HTTP endpoints ----------------
@router.get("/diagnostics")
async def system_diagnostics(user = Depends(get_current_user)):
    checks = await _run_server_side_checks()
    return {
        "generated_at": now_iso(),
        "generated_by": user["name"],
        "overall_ok": all(c["ok"] for c in checks),
        "server_side_checks": checks,
        "app_version": APP_VERSION,
        "database_version": DATABASE_VERSION,
    }


@router.get("/diagnostics/latest")
async def latest_snapshot(user = Depends(get_current_user)):
    """Latest scheduled/manual snapshot. Dashboard uses this to flash if last night's run failed."""
    doc = await db.diagnostic_reports.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    return doc or {}


@router.post("/diagnostics/run-now")
async def run_snapshot_now(user = Depends(require_roles("administrator", "manager"))):
    doc = await _snapshot_diagnostics(source="manual", actor_name=user["name"])
    await audit(user, "diagnostics_snapshot", "system", doc["id"], {"overall_ok": doc["overall_ok"], "failing": doc["failing"]})
    return doc


# ---------------- Onboarding flag ----------------
@router.get("/onboarding/status")
async def onboarding_status(user = Depends(get_current_user)):
    s = await get_settings_doc()
    completed_at = s.get("onboarded_at")
    dismissed_at = s.get("onboarding_dismissed_at")
    return {
        "first_run": not (completed_at or dismissed_at),
        "completed_at": completed_at,
        "dismissed_at": dismissed_at,
    }


@router.post("/onboarding/complete")
async def onboarding_complete(user = Depends(require_roles("administrator"))):
    await get_settings_doc()
    await db.settings.update_one({"id": SETTINGS_ID},
        {"$set": {"onboarded_at": now_iso(), "onboarded_by": user["name"]}})
    await audit(user, "onboarding_complete", "system", SETTINGS_ID)
    return {"ok": True}


@router.post("/onboarding/skip")
async def onboarding_skip(user = Depends(require_roles("administrator"))):
    await get_settings_doc()
    await db.settings.update_one({"id": SETTINGS_ID},
        {"$set": {"onboarding_dismissed_at": now_iso(), "onboarding_dismissed_by": user["name"]}})
    await audit(user, "onboarding_skip", "system", SETTINGS_ID)
    return {"ok": True}


# ---------------- Background scheduler ----------------
async def _seconds_until_next_hour(hour: int) -> float:
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def daily_diagnostics_scheduler():
    """Sleeps until DAILY_SNAPSHOT_HOUR local time each day and stores a diagnostics snapshot.
    Runs one initial snapshot on start so /diagnostics/latest is never empty."""
    import logging
    log = logging.getLogger("diagnostics.scheduler")
    try:
        await _snapshot_diagnostics(source="startup", actor_name="scheduler")
        log.info("diagnostics: initial snapshot recorded")
    except Exception as e:
        log.error(f"diagnostics: initial snapshot failed: {e}")
    while True:
        try:
            secs = await _seconds_until_next_hour(DAILY_SNAPSHOT_HOUR)
            await asyncio.sleep(secs)
            await _snapshot_diagnostics(source="scheduler", actor_name="scheduler")
            log.info(f"diagnostics: {DAILY_SNAPSHOT_HOUR}AM snapshot recorded")
            # Small buffer so we don't loop within the same hour if the run was fast
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"diagnostics: scheduled snapshot failed: {e}")
            await asyncio.sleep(300)  # back off and try again in 5 min
