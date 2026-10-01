"""
FeeHub disaster-recovery backup engine.

Pipeline: mongodump (consistent, read-only export - never raw WiredTiger file
copies while MongoDB is live) -> zip -> encrypt (Fernet/AES, key held outside
the git-tracked source tree) -> upload to Google Drive via the official API
-> verify (size + md5Checksum match) -> record state.

State is persisted to a JSON file so it survives backend restarts (the "is
today's backup already done" check must work even if the service was
restarted between the daily 23:30 trigger and a later shutdown signal), and
mirrored in memory for fast status polling. A single asyncio.Lock makes
concurrent/duplicate triggers (a retried shutdown signal, the daily timer and
a shutdown signal landing close together) collapse into one job rather than
racing - callers that arrive while a job is running, or after one already
succeeded today, get the current/cached state back immediately instead of
starting a second one.

Secrets (the Fernet key, the Google OAuth token) live only under
backend/keys/ on the LIVE server - that whole directory is already excluded
from the git-tracked source tree (see 03-source-code/.gitignore) for the
existing client-update signing key, so this reuses an already-established,
already-correct boundary rather than inventing a new one.
"""
import asyncio
import hashlib
import json
import logging
import os
import shutil
import stat
import subprocess
import zipfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("feehub.backup")

# ---------------- Paths ----------------
BACKUP_ROOT = Path(os.environ.get("FEEHUB_BACKUP_ROOT", r"C:\balaji-fee\backups\disaster-recovery"))
LOCAL_DIR = BACKUP_ROOT / "encrypted"
STAGING_DIR = BACKUP_ROOT / "_staging"
STATE_FILE = BACKUP_ROOT / "state.json"

KEYS_DIR = Path(os.environ.get("FEEHUB_KEYS_DIR", r"C:\balaji-fee\backend\keys"))
ENCRYPTION_KEY_FILE = KEYS_DIR / "backup_encryption.key"
GDRIVE_TOKEN_FILE = KEYS_DIR / "gdrive_token.json"
GDRIVE_CLIENT_SECRET_FILE = KEYS_DIR / "gdrive_client_secret.json"
GDRIVE_FOLDER_ID_CACHE = KEYS_DIR / "gdrive_folder_id.txt"

GDRIVE_FOLDER_NAME = "Balaji FeeHub Backups"
GDRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]  # least privilege: only files this app creates

MONGO_HOST = os.environ.get("FEEHUB_BACKUP_MONGO_HOST", "127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "balaji_fee_db")

DEFAULT_UPLOAD_GRACE_MINUTES = 15
DEFAULT_UPLOAD_RETRY_SECONDS = 30


def _ensure_dirs():
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)


def _restrict_to_admins(path: Path):
    """Best-effort: remove inherited ACLs and grant only Administrators + SYSTEM.
    Never raises - a failure here must not block the backup itself."""
    try:
        subprocess.run(
            ["icacls", str(path), "/inheritance:r",
             "/grant:r", "*S-1-5-32-544:F", "/grant:r", "*S-1-5-18:F"],
            capture_output=True, timeout=10, check=False,
        )
    except Exception:
        logger.warning("Could not restrict ACLs on %s (non-fatal)", path, exc_info=True)


# ---------------- Encryption key ----------------
def get_or_create_encryption_key() -> bytes:
    """Fernet key (AES-128-CBC + HMAC-SHA256, authenticated encryption) via the
    well-reviewed `cryptography` library already in requirements.txt - no
    hand-rolled crypto. Generated once, stored outside the git-tracked tree."""
    from cryptography.fernet import Fernet
    _ensure_dirs()
    if ENCRYPTION_KEY_FILE.exists():
        return ENCRYPTION_KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    ENCRYPTION_KEY_FILE.write_bytes(key)
    _restrict_to_admins(ENCRYPTION_KEY_FILE)
    logger.warning(
        "Generated a NEW backup encryption key at %s. This key is required to decrypt every backup made "
        "from this point forward - store an offline copy (e.g. on a USB drive kept in the Principal's "
        "safe) immediately. Losing this file makes existing encrypted backups permanently unreadable.",
        ENCRYPTION_KEY_FILE,
    )
    return key


# ---------------- State ----------------
@dataclass
class BackupState:
    status: str = "idle"  # idle | running | completed | upload_failed_local_preserved | failed
    date: str = ""  # YYYY-MM-DD this status applies to
    message: str = ""
    trigger: str = ""
    local_backup_path: Optional[str] = None
    local_backup_sha256: Optional[str] = None
    local_backup_size: Optional[int] = None
    cloud_verified: bool = False
    cloud_file_id: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_success_date: Optional[str] = None
    history: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class BackupStateStore:
    """One process-wide instance. The asyncio.Lock gives duplicate-trigger
    protection for free: whoever calls run_backup_cycle while a job is
    already running just awaits the same in-flight job rather than starting
    a second mongodump/upload."""

    def __init__(self):
        self.lock = asyncio.Lock()
        self.state = BackupState()
        self._load()

    def _load(self):
        _ensure_dirs()
        if STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                self.state = BackupState(**{k: v for k, v in data.items() if k in BackupState.__dataclass_fields__})
            except Exception:
                logger.warning("Could not read existing backup state file; starting fresh.", exc_info=True)

    def save(self):
        try:
            STATE_FILE.write_text(json.dumps(self.state.to_dict(), indent=2), encoding="utf-8")
        except Exception:
            logger.error("Could not persist backup state file.", exc_info=True)

    def record_history(self, event: str, detail: str = ""):
        self.state.history.insert(0, {
            "at": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "detail": detail,
        })
        self.state.history = self.state.history[:200]
        self.save()


STORE = BackupStateStore()


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ---------------- mongodump ----------------
def _resolve_mongodump() -> Optional[str]:
    for d in (os.environ.get("PATH") or "").split(os.pathsep):
        cand = Path(d.strip()) / "mongodump.exe"
        if cand.exists():
            return str(cand)
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    mongo_root = Path(program_files) / "MongoDB" / "Server"
    if mongo_root.exists():
        for version_dir in sorted(mongo_root.iterdir(), reverse=True):
            cand = version_dir / "bin" / "mongodump.exe"
            if cand.exists():
                return str(cand)
    return None


async def _run_mongodump_exe(dest_dir: Path) -> tuple[bool, str]:
    exe = _resolve_mongodump()
    if not exe:
        return False, "mongodump.exe not found"
    dest_dir.mkdir(parents=True, exist_ok=True)
    cmd = [exe, "--host", MONGO_HOST, "--db", DB_NAME, "--out", str(dest_dir)]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15 * 60)
    except asyncio.TimeoutError:
        proc.kill()
        return False, "mongodump timed out after 15 minutes."
    if proc.returncode != 0:
        return False, f"mongodump exited {proc.returncode}: {(stderr or stdout).decode(errors='replace')[:2000]}"
    return True, "mongodump.exe completed."


async def _run_pymongo_export(dest_dir: Path) -> tuple[bool, str]:
    """Fallback (and, on this server, the normal path - mongodump.exe/MongoDB Database Tools are not
    installed here) when the mongodump binary is unavailable: export every collection directly through
    the SAME async driver (Motor/PyMongo) the application already uses, writing genuine mongodump-format
    .bson files (raw concatenated BSON documents - what `bson.BSON.encode` produces is byte-identical to
    what mongodump writes), so the output is restorable with a real `mongorestore` if that tool is ever
    installed. This has the exact same consistency property mongodump itself has against a standalone
    (non-replica-set) server: both simply issue a driver-level find() per collection - there is no
    stronger point-in-time guarantee available without transactions, which this application does not use.
    Never reads MongoDB's on-disk WiredTiger files directly."""
    from bson import BSON
    from core import db as motor_db

    db_dir = dest_dir / DB_NAME
    db_dir.mkdir(parents=True, exist_ok=True)
    collection_names = await motor_db.list_collection_names()
    if not collection_names:
        return False, "Database reports zero collections - refusing to treat this as a valid backup."

    total_docs = 0
    for name in collection_names:
        out_path = db_dir / f"{name}.bson"
        count = 0
        with open(out_path, "wb") as fh:
            async for doc in motor_db[name].find({}):
                fh.write(BSON.encode(doc))
                count += 1
        total_docs += count
    return True, f"Exported {len(collection_names)} collections ({total_docs} documents) via the application database driver."


async def _run_mongodump(dest_dir: Path) -> tuple[bool, str]:
    # Prefer the official mongodump.exe when present; otherwise fall back to the equally-consistent
    # PyMongo-based exporter above rather than failing the backup over a missing optional tool.
    ok, msg = await _run_mongodump_exe(dest_dir)
    if not ok:
        logger.info("[FeeHubBackup] %s - using the built-in PyMongo exporter instead.", msg)
        ok, msg = await _run_pymongo_export(dest_dir)
        if not ok:
            return False, msg

    db_dir = dest_dir / DB_NAME
    bson_files = list(db_dir.glob("*.bson")) if db_dir.exists() else []
    if not bson_files:
        return False, "Backup export reported success but produced no .bson files - treating as a failed backup rather than trusting an empty dump."
    # Sanity: the collections a restore absolutely needs must actually be present.
    required = {"students", "receipts", "counters", "users"}
    present = {f.stem for f in bson_files}
    missing = required - present
    if missing:
        return False, f"Backup completed but is missing expected collections: {sorted(missing)}."
    return True, f"{msg} ({len(bson_files)} collection files in {db_dir})."


def _zip_dir(src_dir: Path, dest_zip: Path):
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src_dir):
            for fn in files:
                full = Path(root) / fn
                zf.write(full, full.relative_to(src_dir))


def _encrypt_file(src: Path, dest: Path):
    from cryptography.fernet import Fernet
    key = get_or_create_encryption_key()
    f = Fernet(key)
    data = src.read_bytes()
    token = f.encrypt(data)
    dest.write_bytes(token)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------- Google Drive ----------------
def _gdrive_creds():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    if not GDRIVE_TOKEN_FILE.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_FILE), GDRIVE_SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        GDRIVE_TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    return creds


def _gdrive_service():
    from googleapiclient.discovery import build
    creds = _gdrive_creds()
    if not creds:
        return None
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _get_or_create_folder(service) -> str:
    if GDRIVE_FOLDER_ID_CACHE.exists():
        cached = GDRIVE_FOLDER_ID_CACHE.read_text(encoding="utf-8").strip()
        if cached:
            try:
                f = service.files().get(fileId=cached, fields="id,trashed").execute()
                if not f.get("trashed"):
                    return cached
            except Exception:
                pass  # cached id no longer valid - fall through and re-resolve
    q = f"name = '{GDRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(q=q, fields="files(id,name)").execute()
    files = results.get("files", [])
    if files:
        folder_id = files[0]["id"]
    else:
        meta = {"name": GDRIVE_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}
        folder_id = service.files().create(body=meta, fields="id").execute()["id"]
    GDRIVE_FOLDER_ID_CACHE.write_text(folder_id, encoding="utf-8")
    return folder_id


def _upload_and_verify_sync(local_path: Path) -> tuple[bool, str, Optional[str]]:
    """Synchronous (runs inside asyncio.to_thread) - the googleapiclient library is not async-native."""
    from googleapiclient.http import MediaFileUpload
    service = _gdrive_service()
    if not service:
        return False, (
            "Google Drive is not connected yet. An administrator must run "
            "scripts/setup_google_drive_backup.py once (interactive Google sign-in) - see "
            "10-backup-restore/BACKUP_DISASTER_RECOVERY.md."
        ), None
    try:
        folder_id = _get_or_create_folder(service)
        media = MediaFileUpload(str(local_path), mimetype="application/octet-stream", resumable=True)
        meta = {"name": local_path.name, "parents": [folder_id]}
        request = service.files().create(body=meta, media_body=media, fields="id,name,size,md5Checksum")
        response = None
        while response is None:
            status, response = request.next_chunk()  # resumable: safe to retry a single chunk on transient errors
        file_id = response.get("id")

        local_size = local_path.stat().st_size
        local_md5 = hashlib.md5(local_path.read_bytes()).hexdigest()
        remote_size = int(response.get("size", -1))
        remote_md5 = response.get("md5Checksum")
        if remote_size != local_size:
            return False, f"Upload completed but size mismatch (local {local_size}, Drive reports {remote_size}) - not verified.", file_id
        if remote_md5 and remote_md5 != local_md5:
            return False, "Upload completed but checksum mismatch - not verified.", file_id
        return True, f"Uploaded and verified on Google Drive (file id {file_id}, {local_size:,} bytes, md5 {remote_md5 or 'n/a'}).", file_id
    except Exception as ex:
        return False, f"Google Drive upload failed: {ex}", None


async def upload_and_verify(local_path: Path) -> tuple[bool, str, Optional[str]]:
    return await asyncio.to_thread(_upload_and_verify_sync, local_path)


# ---------------- Orchestration ----------------
async def _do_backup_and_upload(trigger: str, grace_minutes: int, retry_seconds: int):
    state = STORE.state
    today = today_str()
    state.status = "running"
    state.date = today
    state.trigger = trigger
    state.message = "Backup starting..."
    state.started_at = datetime.now(timezone.utc).isoformat()
    state.completed_at = None
    state.cloud_verified = False
    STORE.save()
    STORE.record_history("backup_started", f"trigger={trigger}")

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dump_dir = STAGING_DIR / f"dump-{stamp}"
    ok, msg = await _run_mongodump(dump_dir)
    if not ok:
        state.status = "failed"
        state.message = msg
        STORE.save()
        STORE.record_history("backup_failed", msg)
        shutil.rmtree(dump_dir, ignore_errors=True)
        return

    zip_path = STAGING_DIR / f"feehub-{stamp}.zip"
    try:
        _zip_dir(dump_dir, zip_path)
    finally:
        shutil.rmtree(dump_dir, ignore_errors=True)  # never leave the raw unencrypted dump on disk

    encrypted_path = LOCAL_DIR / f"feehub-backup-{stamp}.enc"
    try:
        _encrypt_file(zip_path, encrypted_path)
    except Exception as ex:
        state.status = "failed"
        state.message = f"Encryption failed: {ex}"
        STORE.save()
        STORE.record_history("backup_failed", state.message)
        zip_path.unlink(missing_ok=True)
        return
    finally:
        zip_path.unlink(missing_ok=True)  # never leave the unencrypted zip on disk either

    state.local_backup_path = str(encrypted_path)
    state.local_backup_size = encrypted_path.stat().st_size
    state.local_backup_sha256 = _sha256_file(encrypted_path)
    state.message = f"Local encrypted backup complete: {encrypted_path.name} ({state.local_backup_size:,} bytes)."
    STORE.save()
    STORE.record_history("backup_completed", state.message)

    await _upload_with_grace_period(encrypted_path, grace_minutes, retry_seconds)


async def _upload_with_grace_period(encrypted_path: Path, grace_minutes: int, retry_seconds: int):
    state = STORE.state
    today = today_str()
    STORE.record_history("upload_started", encrypted_path.name)
    deadline = datetime.now().timestamp() + grace_minutes * 60
    attempt = 0
    last_message = "Upload not attempted."
    while True:
        attempt += 1
        ok, message, file_id = await upload_and_verify(encrypted_path)
        last_message = message
        if ok:
            state.status = "completed"
            state.message = message
            state.cloud_verified = True
            state.cloud_file_id = file_id
            state.completed_at = datetime.now(timezone.utc).isoformat()
            state.last_success_date = today
            STORE.save()
            STORE.record_history("upload_completed", message)
            STORE.record_history("backup_verification", "size+md5 verified against Google Drive")
            return
        logger.warning("[FeeHubBackup] Upload attempt %d failed: %s", attempt, message)
        if datetime.now().timestamp() >= deadline:
            break
        await asyncio.sleep(min(retry_seconds, max(1, deadline - datetime.now().timestamp())))

    # Grace period expired: local backup is preserved, never silently reported as a cloud success.
    state.status = "upload_failed_local_preserved"
    state.message = f"LOCAL_BACKUP_COMPLETE_CLOUD_UPLOAD_FAILED: {last_message}"
    state.cloud_verified = False
    state.completed_at = datetime.now(timezone.utc).isoformat()
    STORE.save()
    STORE.record_history("upload_failed", last_message)


async def run_backup_cycle(trigger: str, grace_minutes: int = DEFAULT_UPLOAD_GRACE_MINUTES,
                            retry_seconds: int = DEFAULT_UPLOAD_RETRY_SECONDS) -> BackupState:
    """Idempotent entry point. Safe to call repeatedly (duplicate shutdown signal, the daily timer firing
    close to a shutdown, a retried HTTP request): only ever runs one job at a time, and never starts a new
    one if today's already succeeded."""
    today = today_str()
    if STORE.state.status == "completed" and STORE.state.date == today and STORE.state.cloud_verified:
        return STORE.state  # already done today - nothing to do

    if STORE.lock.locked():
        return STORE.state  # a job is already in flight - do not start a second one

    async with STORE.lock:
        # Re-check inside the lock in case another caller finished while we were waiting for it.
        if STORE.state.status == "completed" and STORE.state.date == today and STORE.state.cloud_verified:
            return STORE.state
        await _do_backup_and_upload(trigger, grace_minutes, retry_seconds)
    return STORE.state


async def retry_pending_upload(grace_minutes: int = DEFAULT_UPLOAD_GRACE_MINUTES,
                                retry_seconds: int = DEFAULT_UPLOAD_RETRY_SECONDS) -> BackupState:
    """Retries the upload for the CURRENT local preserved file - never creates a new backup just to
    retry the upload (see requirement: never re-upload/re-backup unnecessarily on retry)."""
    if STORE.lock.locked():
        return STORE.state
    if not STORE.state.local_backup_path or STORE.state.status not in ("upload_failed_local_preserved", "failed"):
        return STORE.state
    async with STORE.lock:
        STORE.state.status = "running"
        STORE.save()
        await _upload_with_grace_period(Path(STORE.state.local_backup_path), grace_minutes, retry_seconds)
    return STORE.state


# ---------------- Daily in-process scheduler (no second Windows task) ----------------
DAILY_BACKUP_HOUR = int(os.environ.get("FEEHUB_BACKUP_DAILY_HOUR", "23"))
DAILY_BACKUP_MINUTE = int(os.environ.get("FEEHUB_BACKUP_DAILY_MINUTE", "30"))


async def daily_backup_scheduler():
    """Runs entirely inside the existing FastAPI process - deliberately NOT a Windows Scheduled Task, so
    there is only ever one thing (WindowsPowerScheduler) deciding when Windows shuts down. This just
    means "it's 23:30, do today's backup if it hasn't happened yet" - the same idempotent
    run_backup_cycle() the shutdown signal calls, so whichever fires first (this timer, or an evening
    shutdown) does the real work and the other is a same-day no-op."""
    while True:
        now = datetime.now()
        target = now.replace(hour=DAILY_BACKUP_HOUR, minute=DAILY_BACKUP_MINUTE, second=0, microsecond=0)
        if target <= now:
            target = target + timedelta(days=1)
        sleep_seconds = (target - now).total_seconds()
        try:
            await asyncio.sleep(sleep_seconds)
            logger.info("[FeeHubBackup] Daily scheduled backup time reached (%02d:%02d).", DAILY_BACKUP_HOUR, DAILY_BACKUP_MINUTE)
            await run_backup_cycle(trigger="daily_schedule")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("[FeeHubBackup] Daily scheduler iteration failed (will retry tomorrow).", exc_info=True)


def list_local_backups() -> list[dict]:
    _ensure_dirs()
    out = []
    for f in sorted(LOCAL_DIR.glob("feehub-backup-*.enc"), reverse=True):
        out.append({"filename": f.name, "path": str(f), "size": f.stat().st_size,
                    "modified": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat()})
    return out


def verify_backup_file(encrypted_path: Path, scratch_dir: Path) -> tuple[bool, str]:
    """Decrypts to a scratch location and confirms the result is a valid, readable zip containing a
    non-empty mongodump - used by TEST 2 and the admin "Verify Backup" action. Never touches production."""
    from cryptography.fernet import Fernet, InvalidToken
    try:
        key = get_or_create_encryption_key()
        token = encrypted_path.read_bytes()
        data = Fernet(key).decrypt(token)
    except InvalidToken:
        return False, "Decryption failed: wrong key or the file is corrupted/tampered with."
    except Exception as ex:
        return False, f"Decryption failed: {ex}"

    scratch_dir.mkdir(parents=True, exist_ok=True)
    zip_path = scratch_dir / "restore_check.zip"
    zip_path.write_bytes(data)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            bad = zf.testzip()
            if bad:
                return False, f"Zip integrity check failed at {bad}."
            names = zf.namelist()
            bson_count = sum(1 for n in names if n.endswith(".bson"))
            if bson_count == 0:
                return False, "Decrypted archive contains no .bson files."
            return True, f"Verified: {len(names)} files, {bson_count} collections, decrypts and unzips cleanly."
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)
