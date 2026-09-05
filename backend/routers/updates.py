"""Offline-LAN Software Update System.

Accepts `.bcupdate` ZIP archives (uploaded manually by the administrator over LAN),
verifies SHA-256 checksums and an RSA signature over the manifest, previews
the change, then applies it atomically:

  1) Full DB backup                (via core._create_backup_zip)
  2) Config snapshot               (config collections only)
  3) File-level rollback snapshot  (of every file this update will touch)
  4) Replace files under /app/…
  5) pip install if requirements.txt changed
  6) Run any migration coroutines
  7) Update /app/version.json
  8) Record the install in db.updates
  9) Rotate rollback snapshots (keep last 3)
 10) Exit the backend process (supervisor / NSSM auto-restarts)

Rollback restores every file captured in step 3 and reverts /app/version.json.

Every write-endpoint requires the Administrator PIN.
"""
from __future__ import annotations
import asyncio
import base64
import hashlib
import importlib.util
import json as _json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.exceptions import InvalidSignature

from core import (
    db, audit, gen_id, get_current_user, now_iso, require_admin_pin,
    require_roles, _create_backup_zip, APP_ROOT,
)
from routers.snapshots import _dump_config_now

router = APIRouter(prefix="/api/updates", tags=["updates"])

# ---------------- Paths ----------------
VERSION_FILE  = APP_ROOT / "version.json"
KEYS_DIR      = APP_ROOT / "backend" / "keys"
PRIVATE_KEY   = KEYS_DIR / "update_private.pem"       # dev-only; used by scripts/build_bcupdate.py
PUBLIC_KEY    = KEYS_DIR / "update_public.pem"        # shipped with the app; used for verify
UPDATES_DIR   = APP_ROOT / "updates"
STAGING_DIR   = UPDATES_DIR / "staging"
ROLLBACK_DIR  = UPDATES_DIR / "rollback"

ROLLBACK_KEEP = 3       # last N rollback snapshots kept on disk
MAX_UPLOAD_MB = 500     # hard cap per .bcupdate

# Only files inside these top-level payload subtrees are allowed to be written by an update.
# Anything else in the archive is rejected during verification (defence-in-depth).
ALLOWED_PAYLOAD_ROOTS = (
    "frontend/build",
    "backend/core.py",
    "backend/server.py",
    "backend/routers",
    "backend/requirements.txt",
    "frontend/package.json",
    "static",
    "templates",
    "defaults.json",
    "version.json",
)


# ---------------- Version helpers ----------------
def _parse_semver(v: str) -> Tuple[int, int, int]:
    parts = (v or "0.0.0").strip().split(".")
    try:
        return tuple(int(x) for x in (parts + ["0", "0", "0"])[:3])
    except ValueError:
        return (0, 0, 0)

def _semver_ge(a: str, b: str) -> bool:
    return _parse_semver(a) >= _parse_semver(b)

def read_version() -> Dict[str, Any]:
    if not VERSION_FILE.exists():
        return {"version": "1.0.0", "database_version": "1", "build_date": "unknown"}
    try:
        return _json.loads(VERSION_FILE.read_text())
    except Exception:
        return {"version": "1.0.0", "database_version": "1", "build_date": "unknown"}


def write_version(d: Dict[str, Any]) -> None:
    VERSION_FILE.write_text(_json.dumps(d, indent=2))


# ---------------- Keys ----------------
def ensure_keypair() -> None:
    """Generate a 2048-bit RSA keypair on first run if the developer has not shipped one.
    In real production, the shipped app should ONLY contain PUBLIC_KEY."""
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    if PUBLIC_KEY.exists():
        return
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    PRIVATE_KEY.write_bytes(priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    PUBLIC_KEY.write_bytes(priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ))
    try:
        os.chmod(PRIVATE_KEY, 0o600)
    except Exception:
        pass


def _verify_signature(manifest_bytes: bytes, signature_b64: str) -> None:
    ensure_keypair()
    pub = serialization.load_pem_public_key(PUBLIC_KEY.read_bytes())
    try:
        pub.verify(
            base64.b64decode(signature_b64),
            manifest_bytes,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
    except InvalidSignature:
        raise HTTPException(400, "Update signature is invalid — this package was not produced by the software vendor.")


def _sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------- Manifest verification ----------------
def _validate_payload_paths(paths: List[str]) -> None:
    for rel in paths:
        rel = rel.replace("\\", "/").lstrip("/")
        if ".." in rel.split("/"):
            raise HTTPException(400, f"Illegal path in update: {rel}")
        if not any(rel == root or rel.startswith(root + "/") for root in ALLOWED_PAYLOAD_ROOTS):
            raise HTTPException(400, f"Update tried to write outside allowed roots: {rel}")


def _load_and_verify(update_id: str) -> Dict[str, Any]:
    """Fully verify the extracted update at STAGING_DIR/update_id/ and return the manifest."""
    stage = STAGING_DIR / update_id
    manifest_path = stage / "manifest.json"
    sig_path      = stage / "manifest.sig"
    payload_dir   = stage / "payload"

    if not manifest_path.exists() or not sig_path.exists() or not payload_dir.exists():
        raise HTTPException(400, "Update archive is malformed (missing manifest.json / manifest.sig / payload/).")

    manifest_bytes = manifest_path.read_bytes()
    _verify_signature(manifest_bytes, sig_path.read_text().strip())

    try:
        manifest = _json.loads(manifest_bytes)
    except Exception:
        raise HTTPException(400, "manifest.json is not valid JSON.")

    for k in ("version", "min_supported_version", "release_notes", "files"):
        if k not in manifest:
            raise HTTPException(400, f"manifest.json is missing required field '{k}'.")

    # Check min supported
    current = read_version()["version"]
    if not _semver_ge(current, manifest["min_supported_version"]):
        raise HTTPException(
            400,
            f"This update requires at least version {manifest['min_supported_version']}. "
            f"You are on {current}. Please install the intermediate updates first."
        )

    # Verify every listed file matches its sha256
    files: Dict[str, str] = manifest["files"] or {}
    _validate_payload_paths(list(files.keys()))
    missing, mismatched = [], []
    for rel, sha in files.items():
        target = payload_dir / rel
        if not target.exists():
            missing.append(rel); continue
        actual = _sha256_file(target)
        if actual != sha:
            mismatched.append({"path": rel, "expected": sha, "actual": actual})
    if missing:   raise HTTPException(400, f"Update payload is missing {len(missing)} file(s): {missing[:3]}…")
    if mismatched: raise HTTPException(400, f"Checksum mismatch for {len(mismatched)} file(s): {mismatched[:3]}…")

    return manifest


# ---------------- Apply ----------------
def _copy_to_rollback(target_files: List[str], rollback_id: str, from_version: str) -> Path:
    dest = ROLLBACK_DIR / rollback_id
    dest.mkdir(parents=True, exist_ok=True)
    # A file list is written so we know exactly what to restore
    file_list: List[str] = []
    for rel in target_files:
        src = APP_ROOT / rel
        if src.exists() and src.is_file():
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            file_list.append(rel)
    (dest / "_meta.json").write_text(_json.dumps({
        "rollback_id": rollback_id,
        "from_version": from_version,
        "created_at": now_iso(),
        "files": file_list,
    }, indent=2))
    return dest


def _apply_payload(payload_dir: Path, files: Dict[str, str]) -> None:
    for rel in files.keys():
        src = payload_dir / rel
        dst = APP_ROOT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def _pip_install_requirements() -> Tuple[bool, str]:
    req = APP_ROOT / "backend" / "requirements.txt"
    if not req.exists():
        return True, "requirements.txt not present"
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(req), "--no-cache-dir"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        return r.returncode == 0, (r.stdout[-2000:] + "\n" + r.stderr[-2000:]).strip()
    except subprocess.TimeoutExpired:
        return False, "pip install timed out after 10 minutes"


async def _run_migrations(payload_dir: Path, migrations: List[str]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    mig_root = payload_dir / "migrations"
    for name in migrations:
        p = mig_root / name
        if not p.exists():
            results.append({"name": name, "ok": False, "message": "migration file missing"}); continue
        spec = importlib.util.spec_from_file_location(f"_mig_{name.replace('.py','')}", p)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)  # type: ignore
            fn = getattr(mod, "run", None)
            if fn is None:
                results.append({"name": name, "ok": False, "message": "no `run(db)` coroutine"}); continue
            out = fn(db) if not asyncio.iscoroutinefunction(fn) else await fn(db)
            results.append({"name": name, "ok": True, "message": str(out or "ok")})
        except Exception as e:
            results.append({"name": name, "ok": False, "message": f"{type(e).__name__}: {e}"})
    return results


def _rotate_rollbacks() -> List[str]:
    if not ROLLBACK_DIR.exists():
        return []
    dirs = sorted([d for d in ROLLBACK_DIR.iterdir() if d.is_dir()],
                  key=lambda d: d.stat().st_mtime, reverse=True)
    dropped: List[str] = []
    for d in dirs[ROLLBACK_KEEP:]:
        try:
            shutil.rmtree(d); dropped.append(d.name)
        except Exception:
            pass
    return dropped


async def _delayed_restart(delay: float = 2.0) -> None:
    await asyncio.sleep(delay)
    os._exit(0)   # supervisor / NSSM auto-restarts the backend


# ---------------- Endpoints ----------------
@router.get("/current")
async def current_version(user = Depends(get_current_user)):
    v = read_version()
    installed = await db.updates.count_documents({})
    latest = await db.updates.find_one({}, {"_id": 0}, sort=[("installed_at", -1)])
    rb_count = 0
    if ROLLBACK_DIR.exists():
        rb_count = len([d for d in ROLLBACK_DIR.iterdir() if d.is_dir()])
    return {
        "current": v,
        "installed_count": installed,
        "latest_install": latest,
        "rollback_available": rb_count,
        "rollback_keep": ROLLBACK_KEEP,
        "public_key_fingerprint": _pubkey_fingerprint(),
    }


def _pubkey_fingerprint() -> str:
    try:
        ensure_keypair()
        return hashlib.sha256(PUBLIC_KEY.read_bytes()).hexdigest()[:16]
    except Exception:
        return "unavailable"


@router.get("")
async def list_updates(user = Depends(get_current_user)):
    return await db.updates.find({}, {"_id": 0}).sort("installed_at", -1).to_list(200)


@router.post("/upload")
async def upload_bcupdate(file: UploadFile = File(...), user = Depends(require_admin_pin)):
    """Store, extract & verify a .bcupdate archive. Returns the parsed manifest so the UI
    can show a preview before the admin confirms Install."""
    if not (file.filename or "").lower().endswith(".bcupdate"):
        raise HTTPException(400, "File must have .bcupdate extension.")
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    update_id = gen_id()
    zip_path = STAGING_DIR / f"{update_id}.bcupdate"
    written = 0
    with open(zip_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            written += len(chunk)
            if written > MAX_UPLOAD_MB * 1024 * 1024:
                out.close(); zip_path.unlink(missing_ok=True)
                raise HTTPException(413, f"Update package larger than {MAX_UPLOAD_MB} MB — aborting.")
            out.write(chunk)
    if not zipfile.is_zipfile(zip_path):
        zip_path.unlink(missing_ok=True)
        raise HTTPException(400, "Uploaded file is not a valid ZIP archive.")
    extract_dir = STAGING_DIR / update_id
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        # zip-slip protection
        for name in zf.namelist():
            if name.startswith("/") or ".." in Path(name).parts:
                shutil.rmtree(extract_dir, ignore_errors=True); zip_path.unlink(missing_ok=True)
                raise HTTPException(400, f"Illegal path in archive: {name}")
        zf.extractall(extract_dir)

    try:
        manifest = _load_and_verify(update_id)
    except HTTPException:
        # Keep staging so the UI could show what was there, but easy to rerun
        raise

    checksum = _sha256_file(zip_path)
    await audit(user, "update_upload", "software_update", update_id, {
        "version": manifest["version"], "size_bytes": written,
    })
    return {
        "update_id": update_id,
        "filename": file.filename,
        "size_bytes": written,
        "sha256": checksum,
        "manifest": manifest,
        "valid": True,
    }


@router.get("/staging/{update_id}")
async def staging_manifest(update_id: str, user = Depends(get_current_user)):
    stage = STAGING_DIR / update_id
    if not stage.exists():
        raise HTTPException(404, "Staged update not found (it may have been cleared).")
    manifest = _load_and_verify(update_id)
    return {"update_id": update_id, "manifest": manifest, "valid": True}


@router.delete("/staging/{update_id}")
async def clear_staging(update_id: str, user = Depends(require_admin_pin)):
    stage = STAGING_DIR / update_id
    zip_file = STAGING_DIR / f"{update_id}.bcupdate"
    shutil.rmtree(stage, ignore_errors=True)
    zip_file.unlink(missing_ok=True)
    await audit(user, "update_stage_clear", "software_update", update_id)
    return {"cleared": True}


@router.post("/install/{update_id}")
async def install_update(update_id: str, user = Depends(require_admin_pin)):
    """Apply a staged and verified update. Auto-rolls-back on failure."""
    stage = STAGING_DIR / update_id
    payload_dir = stage / "payload"
    manifest = _load_and_verify(update_id)          # re-verify at install time (defence in depth)

    files: Dict[str, str] = manifest["files"] or {}
    from_version = read_version().get("version", "0.0.0")
    to_version   = manifest["version"]
    rollback_id  = f"{from_version}__{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    log: Dict[str, Any] = {"steps": []}
    def step(name: str, ok: bool, msg: str = "", **extra):
        log["steps"].append({"name": name, "ok": ok, "message": msg, **extra})

    started_at = now_iso()
    update_doc: Dict[str, Any] = {
        "id": update_id,
        "from_version": from_version,
        "to_version": to_version,
        "installed_by": user["name"],
        "installer_email": user["email"],
        "installed_at": started_at,
        "release_notes": manifest.get("release_notes", ""),
        "min_supported_version": manifest["min_supported_version"],
        "files_count": len(files),
        "requires_backend_restart": bool(manifest.get("requires_backend_restart", True)),
        "requires_frontend_reload": bool(manifest.get("requires_frontend_reload", True)),
        "status": "in_progress",
        "rollback_id": rollback_id,
        "rollback_available": True,
        "log": log,
    }

    # 1) DB backup
    try:
        backup = await _create_backup_zip("pre-update", user["name"])
        step("db_backup", True, f"Backup {backup['filename']}", backup_id=backup["id"])
        update_doc["pre_update_backup_id"] = backup["id"]
    except Exception as e:
        step("db_backup", False, str(e))
        update_doc["status"] = "failed"; update_doc["log"] = log
        await db.updates.insert_one(dict(update_doc))
        raise HTTPException(500, f"Update aborted: DB backup failed — {e}")

    # 2) Config snapshot
    try:
        snap_data = await _dump_config_now()
        counts = {k: len(v) for k, v in snap_data.items()}
        sid = gen_id()
        await db.config_snapshots.insert_one({
            "id": sid, "academic_year": from_version,
            "label": f"Pre-update {from_version} → {to_version}",
            "counts": counts, "total_records": sum(counts.values()),
            "created_at": now_iso(), "created_by": user["name"],
            "notes": f"Automatic snapshot before installing update {to_version}.",
            "data": snap_data,
        })
        update_doc["pre_update_snapshot_id"] = sid
        step("config_snapshot", True, f"{sum(counts.values())} rows archived", snapshot_id=sid)
    except Exception as e:
        step("config_snapshot", False, str(e))

    # 3) File-level rollback snapshot
    try:
        _copy_to_rollback(list(files.keys()) + ["version.json"], rollback_id, from_version)
        step("rollback_snapshot", True, f"Backed up {len(files)} file(s)")
    except Exception as e:
        step("rollback_snapshot", False, str(e))
        update_doc["status"] = "failed"; update_doc["log"] = log
        await db.updates.insert_one(dict(update_doc))
        raise HTTPException(500, f"Update aborted: could not snapshot current files — {e}")

    # 4) Apply payload files
    try:
        _apply_payload(payload_dir, files)
        step("apply_payload", True, f"Wrote {len(files)} file(s)")
    except Exception as e:
        step("apply_payload", False, str(e))
        await _restore_rollback(rollback_id)
        step("auto_rollback", True, "Auto-rolled back after failed apply")
        update_doc["status"] = "failed_rolled_back"; update_doc["log"] = log
        await db.updates.insert_one(dict(update_doc))
        raise HTTPException(500, f"Apply failed and was rolled back: {e}")

    # 5) requirements.txt (only if changed)
    if "backend/requirements.txt" in files:
        ok, msg = _pip_install_requirements()
        step("pip_install", ok, msg[:400])
        if not ok:
            await _restore_rollback(rollback_id)
            step("auto_rollback", True, "Auto-rolled back after failed pip install")
            update_doc["status"] = "failed_rolled_back"; update_doc["log"] = log
            await db.updates.insert_one(dict(update_doc))
            raise HTTPException(500, f"pip install failed: {msg[-200:]}")

    # 6) Migrations
    migrations: List[str] = manifest.get("migrations") or []
    if migrations:
        mig_results = await _run_migrations(payload_dir, migrations)
        for r in mig_results:
            step(f"migration:{r['name']}", r["ok"], r["message"])
        if any(not r["ok"] for r in mig_results):
            await _restore_rollback(rollback_id)
            step("auto_rollback", True, "Auto-rolled back after failed migration")
            update_doc["status"] = "failed_rolled_back"; update_doc["log"] = log
            await db.updates.insert_one(dict(update_doc))
            raise HTTPException(500, "One or more migrations failed. Automatic rollback complete.")

    # 7) Update version.json
    try:
        v = read_version()
        v["version"]    = to_version
        v["build_date"] = manifest.get("build_date", now_iso()[:10])
        if manifest.get("database_version"):
            v["database_version"] = str(manifest["database_version"])
        write_version(v)
        step("version_written", True, to_version)
    except Exception as e:
        step("version_written", False, str(e))

    # 8) Record + rotate
    update_doc["status"] = "success"
    update_doc["log"] = log
    await db.updates.insert_one(dict(update_doc))
    dropped = _rotate_rollbacks()
    if dropped:
        step("rollback_rotation", True, f"Dropped {len(dropped)} old rollback(s)", dropped=dropped)

    await audit(user, "update_install", "software_update", update_id, {
        "from": from_version, "to": to_version,
    })

    # 9) Restart the backend (supervisor / NSSM will bring it back up)
    if update_doc["requires_backend_restart"]:
        asyncio.create_task(_delayed_restart(2.0))

    return {
        "ok": True,
        "from_version": from_version,
        "to_version": to_version,
        "restart_scheduled": update_doc["requires_backend_restart"],
        "restart_delay_seconds": 2,
        "log": log,
        "update_id": update_id,
    }


# ---------------- Rollback ----------------
async def _restore_rollback(rollback_id: str) -> Dict[str, Any]:
    src = ROLLBACK_DIR / rollback_id
    meta_path = src / "_meta.json"
    if not src.exists() or not meta_path.exists():
        raise HTTPException(404, f"Rollback snapshot not found: {rollback_id}")
    meta = _json.loads(meta_path.read_text())
    restored: List[str] = []
    for rel in meta.get("files", []):
        s = src / rel
        d = APP_ROOT / rel
        if s.exists():
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d); restored.append(rel)
    # Version.json is always inside meta.files (we included it during snapshot)
    return {"restored": restored, "from_version": meta.get("from_version")}


@router.post("/rollback/{rollback_id}")
async def rollback(rollback_id: str, user = Depends(require_admin_pin)):
    """Restore the file snapshot captured before update `rollback_id` was installed."""
    result = await _restore_rollback(rollback_id)
    to_version = read_version().get("version", "0.0.0")
    await db.updates.insert_one({
        "id": gen_id(),
        "from_version": to_version,
        "to_version": result.get("from_version", "unknown"),
        "installed_by": user["name"],
        "installer_email": user["email"],
        "installed_at": now_iso(),
        "release_notes": f"Rollback to {result.get('from_version')}",
        "min_supported_version": "0.0.0",
        "files_count": len(result["restored"]),
        "requires_backend_restart": True,
        "requires_frontend_reload": True,
        "status": "rolled_back",
        "rollback_id": rollback_id,
        "rollback_available": False,
        "log": {"steps": [{"name": "restore_files", "ok": True, "message": f"Restored {len(result['restored'])} files"}]},
    })
    await audit(user, "update_rollback", "software_update", rollback_id, {
        "restored_files": len(result["restored"]),
    })
    asyncio.create_task(_delayed_restart(2.0))
    return {"ok": True, "restored": result["restored"], "restart_scheduled": True, "restart_delay_seconds": 2}


@router.get("/rollbacks")
async def list_rollbacks(user = Depends(require_roles("administrator"))):
    if not ROLLBACK_DIR.exists():
        return []
    out = []
    for d in sorted(ROLLBACK_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not d.is_dir(): continue
        meta = d / "_meta.json"
        if not meta.exists(): continue
        try:
            m = _json.loads(meta.read_text())
            m["size_bytes"] = sum(p.stat().st_size for p in d.rglob("*") if p.is_file())
            out.append(m)
        except Exception:
            continue
    return out


# ---------------- Public key export (so vendors can verify) ----------------
@router.get("/public-key")
async def public_key(user = Depends(get_current_user)):
    ensure_keypair()
    return {
        "public_key_pem": PUBLIC_KEY.read_text(),
        "fingerprint_sha256_16": _pubkey_fingerprint(),
    }
