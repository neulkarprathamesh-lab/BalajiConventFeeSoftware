"""
FeeHub disaster-recovery backup engine.

Pipeline: mongodump (consistent, read-only export - never raw WiredTiger file
copies while MongoDB is live) -> zip -> encrypt (Fernet/AES, key held outside
the git-tracked source tree) -> copy ONLY the encrypted file into the
JioAICloud synced folder -> verify the copy (size stable + SHA-256 match) ->
record state. JioAICloud exposes no official confirmation API, so a copy in
the sync folder is reported as "placed in sync folder", never as "cloud
upload confirmed".

State is persisted to a JSON file so it survives backend restarts (the "is
today's backup already done" check must work even if the service was
restarted between the daily 23:30 trigger and a later shutdown signal), and
mirrored in memory for fast status polling. A single asyncio.Lock makes
concurrent/duplicate triggers (a retried shutdown signal, the daily timer and
a shutdown signal landing close together) collapse into one job rather than
racing - callers that arrive while a job is running, or after one already
succeeded today, get the current/cached state back immediately instead of
starting a second one.

Secrets (the Fernet key) live only under
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
import time
import zipfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger("feehub.backup")

# ---------------- Paths ----------------
BACKUP_ROOT = Path(os.environ.get("FEEHUB_BACKUP_ROOT", r"C:\balaji-fee\backups\disaster-recovery"))
LOCAL_DIR = BACKUP_ROOT / "encrypted"
STAGING_DIR = BACKUP_ROOT / "_staging"
STATE_FILE = BACKUP_ROOT / "state.json"

KEYS_DIR = Path(os.environ.get("FEEHUB_KEYS_DIR", r"C:\balaji-fee\backend\keys"))
ENCRYPTION_KEY_FILE = KEYS_DIR / "backup_encryption.key"


MONGO_HOST = os.environ.get("FEEHUB_BACKUP_MONGO_HOST", "127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "balaji_fee_db")

KOLKATA = ZoneInfo("Asia/Kolkata")
BACKUP_FILE_PREFIX = "FeeHub_Backup_"

JIO_SYNC_FOLDER = Path(os.environ.get("FEEHUB_JIO_SYNC_FOLDER", r"C:\JioAiCloude\Fee  software backup\JC-Prathame-e100"))
JIO_MAX_ATTEMPTS = 3
JIO_ATTEMPT_TIMEOUT_SECONDS = float(os.environ.get("FEEHUB_JIO_ATTEMPT_TIMEOUT_MINUTES", "10")) * 60
JIO_RETRY_DELAY_SECONDS = float(os.environ.get("FEEHUB_JIO_RETRY_DELAY_SECONDS", "30"))
JIO_STABLE_POLL_SECONDS = float(os.environ.get("FEEHUB_JIO_STABLE_POLL_SECONDS", "3"))
JIO_STABLE_POLLS_REQUIRED = 2


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
    date: str = ""  # DD-MM-YYYY (Asia/Kolkata) this status applies to
    message: str = ""
    trigger: str = ""
    phase: str = "idle"  # idle | backing_up | placing_in_sync_folder | retry_wait | done | failed
    attempt: int = 0
    max_attempts: int = JIO_MAX_ATTEMPTS
    local_backup_path: Optional[str] = None
    local_backup_sha256: Optional[str] = None
    local_backup_size: Optional[int] = None
    local_backup_name: Optional[str] = None
    sync_state: str = "none"  # none | placed_in_sync_folder | not_placed
    sync_folder: Optional[str] = None
    placed_file: Optional[str] = None
    cloud_verified: bool = False  # always False: JioAICloud has no official confirmation API
    sha256_verified: bool = False
    collections_count: Optional[int] = None
    collections_list: list = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_success_date: Optional[str] = None
    history: list = field(default_factory=list)
    legacy_history: list = field(default_factory=list)  # audit records from the earlier Google Drive backup system
    legacy_migrated: bool = False

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
        self._migrate_legacy()

    def _migrate_legacy(self):
        """One-time: move every record from the earlier Google Drive backup system into legacy_history so the
        current JioAICloud status never shows it. Nothing is deleted - the records stay as historical audit
        history, and the old encrypted files stay on disk."""
        s = self.state
        if s.legacy_migrated:
            return
        s.legacy_history = list(s.legacy_history) + list(s.history)
        s.history = []
        if s.status in ("upload_failed_local_preserved", "failed", "completed", "running") and "Google" in (s.message or "") + (s.status or ""):
            s.status = "idle"
            s.phase = "idle"
            s.message = ""
            s.local_backup_path = None
            s.local_backup_sha256 = None
            s.local_backup_size = None
            s.local_backup_name = None
            s.sync_state = "none"
        s.legacy_migrated = True
        self.save()

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


def now_kolkata() -> datetime:
    return datetime.now(KOLKATA)


def today_str() -> str:
    return now_kolkata().strftime("%d-%m-%Y")


def backup_filename(stamp: datetime) -> str:
    return f"{BACKUP_FILE_PREFIX}{stamp.strftime('%d-%m-%Y_%H-%M-%S')}.enc"


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


# ---------------- JioAICloud synced folder ----------------
def _remove_partial_copy(dest: Path):
    for _ in range(5):
        try:
            dest.unlink(missing_ok=True)
            return
        except OSError:
            time.sleep(1)  # a just-written file can be briefly locked by indexing/antivirus
    logger.error("[FeeHubBackup] Could not remove a partial sync-folder copy at %s - remove it manually.", dest)


def _copy_and_verify_into_sync_folder(src: Path, dest: Path, deadline: float) -> tuple[bool, str]:
    expected_size = src.stat().st_size
    expected_sha = _sha256_file(src)
    created = False
    try:
        with open(src, "rb") as fin, open(dest, "xb") as fout:
            created = True
            while True:
                if time.time() > deadline:
                    raise TimeoutError("copy into the sync folder exceeded the attempt time limit")
                chunk = fin.read(1024 * 1024)
                if not chunk:
                    break
                fout.write(chunk)
        last_size = None
        stable_polls = 0
        while True:
            if time.time() > deadline:
                raise TimeoutError("the sync folder copy did not become size-stable before the attempt time limit")
            size = dest.stat().st_size
            stable_polls = stable_polls + 1 if (size == expected_size and size == last_size) else 0
            last_size = size
            if stable_polls >= JIO_STABLE_POLLS_REQUIRED:
                break
            time.sleep(JIO_STABLE_POLL_SECONDS)
        if _sha256_file(dest) != expected_sha:
            raise ValueError("SHA-256 of the sync folder copy does not match the local encrypted backup")
        return True, "copy complete, size stable, SHA-256 matches the local encrypted backup"
    except Exception as ex:
        if created:
            _remove_partial_copy(dest)  # never leave a partial or mismatched copy behind
        return False, str(ex)


def _place_in_sync_folder_once(src: Path, deadline: float) -> tuple[bool, str, Optional[Path]]:
    if not JIO_SYNC_FOLDER.is_dir():
        return False, f"JioAICloud sync folder is not accessible: {JIO_SYNC_FOLDER}", None
    if not os.access(JIO_SYNC_FOLDER, os.W_OK):
        return False, f"JioAICloud sync folder is not writable: {JIO_SYNC_FOLDER}", None
    dest = JIO_SYNC_FOLDER / src.name
    if dest.exists():
        if _sha256_file(dest) == _sha256_file(src):
            return True, "already present in the sync folder with matching SHA-256", dest
        return False, f"A different file already exists in the sync folder with this name ({src.name}); refusing to overwrite.", None
    ok, detail = _copy_and_verify_into_sync_folder(src, dest, deadline)
    return ok, detail, dest if ok else None


async def _place_in_sync_folder_with_retries(encrypted_path: Path):
    state = STORE.state
    today = today_str()
    last_message = "not attempted"
    for attempt in range(1, JIO_MAX_ATTEMPTS + 1):
        state.attempt = attempt
        state.phase = "placing_in_sync_folder"
        state.message = f"Copying encrypted backup to JioAICloud sync folder (attempt {attempt}/{JIO_MAX_ATTEMPTS})..."
        STORE.save()
        STORE.record_history("sync_attempt_started", f"attempt {attempt}/{JIO_MAX_ATTEMPTS}")
        deadline = time.time() + JIO_ATTEMPT_TIMEOUT_SECONDS
        try:
            ok, detail, dest = await asyncio.to_thread(_place_in_sync_folder_once, encrypted_path, deadline)
        except Exception as ex:
            ok, detail, dest = False, f"unexpected error: {ex}", None
        if ok:
            state.status = "completed"
            state.phase = "done"
            state.sha256_verified = True
            state.sync_state = "placed_in_sync_folder"
            state.sync_folder = str(JIO_SYNC_FOLDER)
            state.placed_file = str(dest)
            state.message = (f"Backup ready: {encrypted_path.name} placed in the JioAICloud sync folder "
                             f"and verified (SHA-256 matches). Cloud upload is NOT independently confirmed.")
            state.cloud_verified = False
            state.completed_at = datetime.now(timezone.utc).isoformat()
            state.last_success_date = today
            STORE.save()
            STORE.record_history("sync_folder_placed", f"attempt {attempt}/{JIO_MAX_ATTEMPTS}: {detail}")
            return
        last_message = detail
        logger.warning("[FeeHubBackup] JioAICloud sync attempt %d/%d failed: %s", attempt, JIO_MAX_ATTEMPTS, detail)
        STORE.record_history("sync_attempt_failed", f"attempt {attempt}/{JIO_MAX_ATTEMPTS}: {detail}")
        if attempt < JIO_MAX_ATTEMPTS:
            state.phase = "retry_wait"
            state.message = f"Attempt {attempt}/{JIO_MAX_ATTEMPTS} failed: {detail}. Retrying..."
            STORE.save()
            await asyncio.sleep(JIO_RETRY_DELAY_SECONDS)

    # All attempts exhausted: the local encrypted backup is kept and shutdown is allowed to continue.
    state.status = "upload_failed_local_preserved"
    state.phase = "failed"
    state.sync_state = "not_placed"
    state.placed_file = None
    state.message = (f"LOCAL_BACKUP_COMPLETE_SYNC_FAILED_AFTER_{JIO_MAX_ATTEMPTS}_ATTEMPTS: {last_message}. "
                     f"Local encrypted backup preserved. Shutdown is allowed to continue.")
    state.cloud_verified = False
    state.sha256_verified = False
    state.completed_at = datetime.now(timezone.utc).isoformat()
    STORE.save()
    STORE.record_history("sync_failed", state.message)


# ---------------- Orchestration ----------------
async def _do_backup_and_upload(trigger: str):
    state = STORE.state
    today = today_str()
    state.status = "running"
    state.phase = "backing_up"
    state.date = today
    state.trigger = trigger
    state.message = "Backup starting..."
    state.attempt = 0
    state.sync_state = "none"
    state.sync_folder = None
    state.placed_file = None
    state.started_at = datetime.now(timezone.utc).isoformat()
    state.completed_at = None
    state.cloud_verified = False
    STORE.save()
    STORE.record_history("backup_started", f"trigger={trigger}")

    stamp_dt = now_kolkata()
    while (LOCAL_DIR / backup_filename(stamp_dt)).exists():
        await asyncio.sleep(1)  # never overwrite: wait for the next second so the timestamp is unique
        stamp_dt = now_kolkata()
    stamp = stamp_dt.strftime("%d-%m-%Y_%H-%M-%S")
    dump_dir = STAGING_DIR / f"dump-{stamp}"
    ok, msg = await _run_mongodump(dump_dir)
    if not ok:
        state.status = "failed"
        state.message = msg
        STORE.save()
        STORE.record_history("backup_failed", msg)
        shutil.rmtree(dump_dir, ignore_errors=True)
        return
    collection_files = sorted((dump_dir / DB_NAME).glob("*.bson"))
    state.collections_list = [f.stem for f in collection_files]
    state.collections_count = len(collection_files)
    state.sha256_verified = False

    zip_path = STAGING_DIR / f"feehub-{stamp}.zip"
    try:
        _zip_dir(dump_dir, zip_path)
    finally:
        shutil.rmtree(dump_dir, ignore_errors=True)  # never leave the raw unencrypted dump on disk

    encrypted_path = LOCAL_DIR / backup_filename(stamp_dt)
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
    state.local_backup_name = encrypted_path.name
    state.local_backup_size = encrypted_path.stat().st_size
    state.local_backup_sha256 = _sha256_file(encrypted_path)
    state.message = f"Local encrypted backup complete: {encrypted_path.name} ({state.local_backup_size:,} bytes)."
    STORE.save()
    STORE.record_history("backup_completed", state.message)

    await _place_in_sync_folder_with_retries(encrypted_path)


async def run_backup_cycle(trigger: str) -> BackupState:
    """Idempotent entry point. Safe to call repeatedly (duplicate shutdown signal, the daily timer firing
    close to a shutdown, a retried HTTP request): only ever runs one job at a time, and never starts a new
    one if today's backup was already placed in the sync folder."""
    today = today_str()
    if STORE.state.status == "completed" and STORE.state.date == today:
        return STORE.state  # already done today - nothing to do

    if STORE.lock.locked():
        return STORE.state  # a job is already in flight - do not start a second one

    async with STORE.lock:
        # Re-check inside the lock in case another caller finished while we were waiting for it.
        if STORE.state.status == "completed" and STORE.state.date == today:
            return STORE.state
        try:
            await _do_backup_and_upload(trigger)
        except Exception as ex:
            logger.error("[FeeHubBackup] Backup job crashed.", exc_info=True)
            STORE.state.status = "failed"
            STORE.state.phase = "failed"
            STORE.state.message = f"Backup job failed unexpectedly: {ex}. Shutdown is allowed to continue."
            STORE.state.completed_at = datetime.now(timezone.utc).isoformat()
            STORE.save()
            STORE.record_history("backup_failed", STORE.state.message)
    return STORE.state


async def retry_pending_upload() -> BackupState:
    """Retries the sync-folder placement for the CURRENT local preserved file - never creates a new backup
    just to retry the copy."""
    if STORE.lock.locked():
        return STORE.state
    if not STORE.state.local_backup_path or STORE.state.status not in ("upload_failed_local_preserved", "failed"):
        return STORE.state
    async with STORE.lock:
        STORE.state.status = "running"
        STORE.state.phase = "placing_in_sync_folder"
        STORE.save()
        await _place_in_sync_folder_with_retries(Path(STORE.state.local_backup_path))
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
        now = now_kolkata()
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
    files = list(LOCAL_DIR.glob(f"{BACKUP_FILE_PREFIX}*.enc")) + list(LOCAL_DIR.glob("feehub-backup-*.enc"))
    for f in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True):
        out.append({"filename": f.name, "size": f.stat().st_size,
                    "modified": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
                    "legacy": not f.name.startswith(BACKUP_FILE_PREFIX)})
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
            coll = sorted(n[:-len(".bson")] for n in names if n.endswith(".bson"))
            return True, f"Verified: {bson_count} collections ({', '.join(coll)}), decrypts and unzips cleanly."
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)
