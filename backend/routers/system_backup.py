"""FeeHub disaster-recovery backup API.

Two trust boundaries:
  - System endpoints (prepare-shutdown, status) are called by WindowsPowerScheduler, which runs headlessly
    as SYSTEM with no FeeHub user login - gated by a shared secret (X-WPS-Backup-Key) checked against
    WPS_BACKUP_API_KEY in backend/.env, never by a user JWT.
  - Admin endpoints (run-now, retry-upload, history, verify) are the Backup / Disaster Recovery screen in
    the UI - gated by the normal administrator-role JWT, same as every other admin-only route.
Neither path ever returns backup file contents, the encryption key, or Google credentials - only status.
"""
import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header
from core import audit, require_roles, get_current_user

import backup_engine as be

router = APIRouter(prefix="/api/system-backup", tags=["system-backup"])

SYSTEM_USER = {"id": "system-wps", "email": "system@windows-power-scheduler.local",
               "name": "WindowsPowerScheduler (automated)", "role": "system"}


async def require_wps_backup_key(x_wps_backup_key: Optional[str] = Header(None)):
    expected = os.environ.get("WPS_BACKUP_API_KEY")
    if not expected:
        raise HTTPException(500, "WPS_BACKUP_API_KEY is not configured on the server.")
    if not x_wps_backup_key or x_wps_backup_key != expected:
        raise HTTPException(401, "Invalid or missing backup signal key.")
    return True


def _status_payload() -> dict:
    s = be.STORE.state
    return {
        "status": s.status, "date": s.date, "message": s.message, "trigger": s.trigger,
        "local_backup_size": s.local_backup_size, "local_backup_sha256": s.local_backup_sha256,
        "cloud_verified": s.cloud_verified, "started_at": s.started_at, "completed_at": s.completed_at,
        "last_success_date": s.last_success_date,
        # Deliberately omits local_backup_path (server filesystem layout) and anything from keys/.
    }


# ---------------- System (WindowsPowerScheduler) ----------------

@router.post("/prepare-shutdown")
async def prepare_shutdown(_=Depends(require_wps_backup_key)):
    """Idempotent trigger. Starts the backup in the background and returns immediately so the caller can
    poll /status - this call itself never blocks for the full backup duration. If today's backup already
    succeeded, or one is already running, this returns that status without starting a second job."""
    today = be.today_str()
    if be.STORE.state.status == "completed" and be.STORE.state.date == today and be.STORE.state.cloud_verified:
        return {"status": "already_done", "message": f"Backup already completed and verified today ({today})."}
    if be.STORE.lock.locked():
        return {"status": "running", "message": "A backup is already in progress."}

    await audit(SYSTEM_USER, "backup_started", "system_backup", today, {"trigger": "shutdown_signal"})
    import asyncio
    asyncio.create_task(be.run_backup_cycle(trigger="shutdown_signal"))
    return {"status": "started", "message": "Backup started."}


@router.get("/status")
async def get_status(_=Depends(require_wps_backup_key)):
    return _status_payload()


# ---------------- Admin UI ----------------

@router.get("/admin/status")
async def admin_status(user=Depends(require_roles("administrator"))):
    payload = _status_payload()
    payload["history"] = be.STORE.state.history[:50]
    payload["local_backups"] = be.list_local_backups()
    payload["gdrive_connected"] = be.GDRIVE_TOKEN_FILE.exists()
    payload["encryption_key_present"] = be.ENCRYPTION_KEY_FILE.exists()
    return payload


@router.post("/admin/run-now")
async def run_now(user=Depends(require_roles("administrator"))):
    today = be.today_str()
    if be.STORE.lock.locked():
        return {"status": "running", "message": "A backup is already in progress."}
    await audit(user, "backup_started", "system_backup", today, {"trigger": "manual"})
    import asyncio
    asyncio.create_task(be.run_backup_cycle(trigger="manual"))
    return {"status": "started", "message": "Backup started."}


@router.post("/admin/retry-upload")
async def retry_upload(user=Depends(require_roles("administrator"))):
    if be.STORE.state.status not in ("upload_failed_local_preserved", "failed"):
        raise HTTPException(400, "There is no pending failed upload to retry.")
    await audit(user, "upload_started", "system_backup", be.STORE.state.date, {"trigger": "manual_retry"})
    import asyncio
    asyncio.create_task(be.retry_pending_upload())
    return {"status": "retrying", "message": "Retry started."}


@router.post("/admin/verify/{filename}")
async def verify_backup(filename: str, user=Depends(require_roles("administrator"))):
    """Decrypts the named local backup to a throwaway scratch folder to confirm it is genuinely
    restorable, then deletes the scratch copy. Never touches production data."""
    safe_name = Path(filename).name  # strip any path components - never trust the raw input as a path
    target = be.LOCAL_DIR / safe_name
    if not target.exists() or not safe_name.startswith("feehub-backup-"):
        raise HTTPException(404, "Backup file not found.")
    scratch = be.BACKUP_ROOT / "_verify_scratch" / safe_name
    ok, message = be.verify_backup_file(target, scratch)
    await audit(user, "backup_verification", "system_backup", safe_name, {"ok": ok, "message": message})
    if not ok:
        raise HTTPException(422, message)
    return {"ok": True, "message": message}


@router.get("/admin/history")
async def history(user=Depends(require_roles("administrator"))):
    return {"history": be.STORE.state.history}
