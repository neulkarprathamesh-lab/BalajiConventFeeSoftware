"""Final Delivery Center — one aggregator endpoint that lists every downloadable artefact.
Also exposes lightweight generators for the license doc and the receipt-types JSON."""
import io
import json as _json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import StreamingResponse
from core import db, get_current_user, now_iso, require_admin_pin, require_roles, APP_ROOT

router = APIRouter(prefix="/api", tags=["deliverables"])

DIST_DIR = APP_ROOT / "dist"
# Served at runtime from frontend/build (what the frontend web server actually
# exposes at /downloads/...), not frontend/public (the pre-build CRA source dir).
DL_DIR = APP_ROOT / "frontend" / "build" / "downloads"
BACKUP_DIR = APP_ROOT / "backups"


def _file_meta(p: Path, label: str, category: str) -> Dict[str, Any]:
    if not p.exists():
        return {"label": label, "category": category, "available": False,
                "note": "Not yet built — click 'Rebuild' in Admin → Install Package."}
    size = p.stat().st_size
    mtime = datetime.fromtimestamp(p.stat().st_mtime).isoformat()
    return {
        "label": label, "category": category, "available": True,
        "size_bytes": size, "size_mb": round(size / 1024 / 1024, 2),
        "modified_at": mtime,
        "download_url": f"/downloads/{p.name}" if p.parent == DL_DIR else None,
    }


@router.get("/deliverables/manifest")
async def deliverables_manifest(user = Depends(require_roles("administrator"))):
    """Day-to-day deliverables the administrator can pull from inside the running app.
    Full source code is delivered separately as a one-shot project ZIP for offline archival."""
    backups = sorted(BACKUP_DIR.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True) if BACKUP_DIR.exists() else []
    latest_backup = backups[0] if backups else None
    final_zip = DL_DIR / "BalajiConventFeeSoftware_v1.0_FINAL.zip"
    version_file = APP_ROOT / "version.json"
    app_version = "1.0.0"
    if version_file.exists():
        try:
            import json as _j
            app_version = _j.loads(version_file.read_text()).get("version", "1.0.0")
        except Exception: pass
    return {
        "app_version": app_version, "database_version": "1", "generated_at": now_iso(),
        "sections": [
            {"title": "Production Release", "icon": "package",
             "items": [
                 _file_meta(final_zip, "Balaji FeeHub v1.0 — final source ZIP (installers + backend + frontend + scripts + docs)", "release"),
                 {"label": "Rebuild the production ZIP now",
                  "endpoint": "/api/deliverables/rebuild-zip", "method": "POST",
                  "available": True,
                  "note": "Runs scripts/build_final_zip.py to regenerate BalajiFeeHub-v1.0-FINAL.zip. Requires Admin PIN."},
             ]},
            {"title": "Database Package", "icon": "database",
             "items": [
                 {"label": "Latest database backup",
                  "endpoint": f"/api/config/backups/{backups[0].stem.split('-')[-1]}/download" if latest_backup else None,
                  "manual_url": "/api/config/backups", "available": bool(latest_backup),
                  "note": "Full mongodump-style JSON per collection, with manifest.json + SHA-256 checksum."},
                 {"label": "Trigger a new backup now",
                  "endpoint": "/api/config/backup", "method": "POST",
                  "available": True,
                  "note": "Requires Administrator PIN."},
             ]},
            {"title": "Configuration Export", "icon": "settings",
             "items": [
                 {"label": "School configuration (settings, departments, classes, fee structures, receipt types, bus routes, users w/o passwords)",
                  "endpoint": "/api/config/export", "method": "GET",
                  "available": True,
                  "note": "Streams a ZIP with one JSON per collection + README + manifest. Requires Admin PIN."},
             ]},
            {"title": "Documentation", "icon": "book",
             "items": [
                 {"label": "License & Ownership", "endpoint": "/api/deliverables/license", "method": "GET", "available": True},
                 {"label": "Release Notes v1.0", "endpoint": "/api/deliverables/release-notes", "method": "GET", "available": True},
                 {"label": "Self-Host Guide", "route": "/SELF_HOST_GUIDE.md", "available": (APP_ROOT / "SELF_HOST_GUIDE.md").exists()},
             ]},
            {"title": "Version & Audit", "icon": "history",
             "items": [
                 {"label": "Current version snapshot",
                  "endpoint": "/api/version", "method": "GET", "available": True},
                 {"label": "Diagnostics report",
                  "endpoint": "/api/diagnostics", "method": "GET", "available": True},
                 {"label": "Software updates history",
                  "endpoint": "/api/updates", "method": "GET", "available": True,
                  "note": "Every .bcupdate install + rollback recorded here."},
             ]},
        ],
    }


@router.post("/deliverables/rebuild-zip")
async def rebuild_zip(user = Depends(require_admin_pin)):
    """Regenerate BalajiFeeHub-v1.0-FINAL.zip using scripts/build_final_zip.py."""
    import subprocess, sys
    from pathlib import Path as _P
    script = _P("/app/scripts/build_final_zip.py")
    if not script.exists():
        raise HTTPException(500, "build_final_zip.py is missing.")
    try:
        r = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, timeout=300, cwd="/app",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "ZIP build timed out after 5 minutes.")
    if r.returncode != 0:
        raise HTTPException(500, f"Build failed: {r.stderr[-1000:] or r.stdout[-1000:]}")
    zip_path = DL_DIR / "BalajiConventFeeSoftware_v1.0_FINAL.zip"
    return {
        "ok": True,
        "download_url": f"/downloads/{zip_path.name}",
        "size_mb": round(zip_path.stat().st_size / 1024 / 1024, 2) if zip_path.exists() else 0,
        "log_tail": r.stdout[-800:],
    }


@router.get("/deliverables/license")
async def download_license(user = Depends(require_roles("administrator"))):
    p = DIST_DIR / "BalajiConventFeeSoftware-v1.0" / "LICENSE_AND_OWNERSHIP.md"
    if not p.exists():
        raise HTTPException(404, "License document not yet built.")
    return StreamingResponse(
        open(p, "rb"), media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="LICENSE_AND_OWNERSHIP.md"'},
    )


@router.get("/deliverables/release-notes")
async def download_release_notes(user = Depends(require_roles("administrator"))):
    p = DIST_DIR / "BalajiConventFeeSoftware-v1.0" / "RELEASE_NOTES.md"
    if not p.exists():
        raise HTTPException(404, "Release notes not yet built.")
    return StreamingResponse(
        open(p, "rb"), media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="RELEASE_NOTES_v1.0.md"'},
    )



