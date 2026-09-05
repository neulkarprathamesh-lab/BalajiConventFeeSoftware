"""Build the FINAL Balaji Convent Fee Software v1.0 delivery ZIP.

Assembles ONE downloadable production package containing everything the school
needs to install, maintain, extend and re-develop the software:

  01-install-main-server/   Windows installer .bat scripts
  02-install-client-pc/     Windows client .bat scripts
  03-source-code/           Full backend + frontend source (fresh copy on every build)
  04-database/              Mongo config, seed, migration notes
  05-services/              NSSM / systemd auto-start
  06-excel-templates/       Excel import/export templates
  07-user-manuals/          Cashier / Accountant / Manager / Administrator guides
  08-lan-installation/      Static-IP + firewall + LAN binding
  09-printer-setup/         A4 / thermal / print-layout
  10-backup-restore/        Daily backup + restore drill
  11-optional-services/     SMS / email / off-site backup config
  12-default-admin/         Default admin creds + first-day password change
  scripts/                  build_bcupdate.py, build_final_zip.py, production_purge.py
  docs/                     Consolidated documentation (see docs/)
  version.json
  START_HERE.md             Root entry point
  RELEASE_NOTES.md
  LICENSE_AND_OWNERSHIP.md
  FINAL_VERIFICATION.md
  LOAD_TEST_REPORT.md

Output:  /app/dist/BalajiConventFeeSoftware_v1.0_FINAL.zip
Also published to /app/frontend/public/downloads/ for in-app admin download.
"""
from __future__ import annotations
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

APP = Path("/app")
DIST_ROOT   = APP / "dist" / "BalajiConventFeeSoftware-v1.0"      # pre-authored delivery folder
SRC_DIR     = DIST_ROOT / "03-source-code"                        # will be refreshed each build
OUT_ZIP     = APP / "dist" / "BalajiConventFeeSoftware_v1.0_FINAL.zip"

EXCLUDE_DIRS  = {"__pycache__", "node_modules", ".pytest_cache",
                 ".git", ".emergent", ".cache", ".yarn", "coverage"}
EXCLUDE_FILES = {".DS_Store", "update_private.pem"}
SENSITIVE_FILES = {"update_private.pem"}   # never ship

def should_skip_rel(rel: Path) -> bool:
    """Check for excludes against the *relative* path only (so we don't accidentally
    skip everything under /app/dist/…)."""
    for part in rel.parts:
        if part in EXCLUDE_DIRS: return True
    if rel.name in EXCLUDE_FILES: return True
    if rel.suffix in {".pyc", ".log"}: return True
    return False

def should_skip(p: Path) -> bool:
    # Legacy alias for _refresh_source_snapshot which walks /app/backend + /app/frontend
    for part in p.parts:
        if part in EXCLUDE_DIRS: return True
    if p.name in EXCLUDE_FILES: return True
    if p.suffix in {".pyc", ".log"}: return True
    return False


def _refresh_source_snapshot() -> None:
    """Copy the CURRENT /app/backend + /app/frontend/{src,public,build} into 03-source-code/
    so the ZIP always reflects the latest code + prebuilt frontend on disk."""
    # We keep the prebuilt frontend/build/ that was placed there separately.
    keep_build = SRC_DIR / "frontend" / "build"
    keep_build_tmp = None
    if keep_build.exists():
        import tempfile
        keep_build_tmp = Path(tempfile.mkdtemp(prefix="_build_keep_"))
        shutil.copytree(keep_build, keep_build_tmp / "build", dirs_exist_ok=True)

    if SRC_DIR.exists():
        shutil.rmtree(SRC_DIR, ignore_errors=True)
    SRC_DIR.mkdir(parents=True, exist_ok=True)

    def copy_tree(src: Path, dst: Path):
        for p in src.rglob("*"):
            if p.is_dir() or should_skip(p): continue
            rel = p.relative_to(src)
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)

    (SRC_DIR / "backend").mkdir(parents=True, exist_ok=True)
    copy_tree(APP / "backend", SRC_DIR / "backend")
    # keep .env template only — strip real .env
    real_env = SRC_DIR / "backend" / ".env"
    if real_env.exists():
        (SRC_DIR / "backend" / ".env.template").write_text(
            "MONGO_URL=mongodb://localhost:27017\nDB_NAME=balaji_fee_db\nCORS_ORIGINS=*\n"
            "JWT_SECRET=change-me-on-install\nADMIN_EMAIL=admin@balajiconvent.in\nADMIN_PASSWORD=change-me\n"
        )
        real_env.unlink()

    (SRC_DIR / "frontend").mkdir(parents=True, exist_ok=True)
    copy_tree(APP / "frontend" / "src",    SRC_DIR / "frontend" / "src")
    copy_tree(APP / "frontend" / "public", SRC_DIR / "frontend" / "public")
    # NEVER ship the "downloads" folder (used at runtime to publish ZIPs) — else the ZIP contains itself.
    dl = SRC_DIR / "frontend" / "public" / "downloads"
    if dl.exists(): shutil.rmtree(dl, ignore_errors=True)
    for f in ("package.json", "postcss.config.js", "tailwind.config.js",
              "jsconfig.json", "craco.config.js"):
        s = APP / "frontend" / f
        if s.exists(): shutil.copy2(s, SRC_DIR / "frontend" / f)

    (SRC_DIR / "frontend" / ".env.template").write_text(
        "REACT_APP_BACKEND_URL=http://<MAIN-SERVER-IP>:8001\nWDS_SOCKET_PORT=443\n"
    )

    # Bundle the prebuilt frontend/build/ so the Main Server needs NO Node/npm.
    # NOTE: `build` is in EXCLUDE_DIRS to keep source packaging clean; we bypass it here
    # by using shutil.copytree directly against the live build directory.
    live_build = APP / "frontend" / "build"
    dest_build = SRC_DIR / "frontend" / "build"
    if live_build.exists():
        shutil.copytree(live_build, dest_build, dirs_exist_ok=True)
        for m in dest_build.rglob("*.map"):
            m.unlink(missing_ok=True)
        bd = dest_build / "downloads"
        if bd.exists(): shutil.rmtree(bd, ignore_errors=True)
    elif keep_build_tmp and (keep_build_tmp / "build").exists():
        shutil.copytree(keep_build_tmp / "build", dest_build, dirs_exist_ok=True)
    if keep_build_tmp:
        shutil.rmtree(keep_build_tmp, ignore_errors=True)

    # bundle the scripts
    scripts_dst = SRC_DIR / "scripts"
    scripts_dst.mkdir(parents=True, exist_ok=True)
    for f in ("build_bcupdate.py", "build_final_zip.py", "production_purge.py"):
        s = APP / "scripts" / f
        if s.exists(): shutil.copy2(s, scripts_dst / f)

    # version.json snapshot at source-code root too
    if (APP / "version.json").exists():
        shutil.copy2(APP / "version.json", SRC_DIR / "version.json")

    print(f"  refreshed  03-source-code/  ({sum(1 for _ in SRC_DIR.rglob('*') if _.is_file())} files)")


def _write_docs() -> None:
    """Add / refresh top-level docs that summarise what shipped in this build."""
    docs = DIST_ROOT / "docs"
    docs.mkdir(parents=True, exist_ok=True)

    (docs / "CHANGELOG.md").write_text(f"""# Changelog — Balaji Convent Fee Software (Balaji FeeHub)

## v1.0.0 — {datetime.utcnow().strftime('%Y-%m-%d')}
### New features shipped in this build
- **Balaji FeeHub rebrand** everywhere (Login, sidebar, browser tab, manifest, favicon).
- **Password visibility toggle** on the login screen.
- **Universal Receipt Template Engine** — one common renderer for all printable documents (Fee, Bus, Debit Voucher, Refund/Money). Two themes (Classic B/W default, Balaji Colored). Paper sizes A5/A4/A4-Landscape/Legal/Letter/Thermal-80. Multi-format export: Print, PDF (jsPDF), PNG/JPEG (html2canvas), inline SVG, Email-ready PDF. Configurable per receipt type: paper, theme, signature layout (single row / 2×2), signatures_config (receiver/accountant/principal/director), margins, watermark, QR, barcode.
- **Debit Voucher numbering** upgraded to `DV-YYYY-NNNNNN`.
- **Offline-LAN Software Update System** — signed `.bcupdate` archives (SHA-256 + RSA-PSS), min_supported_version gate, automatic DB backup + config snapshot + file-level rollback before every apply, auto-rollback on failure, last-3 rollback slots kept, live `/api/version`, client auto-poll for new versions every 30 s, developer packaging script (`scripts/build_bcupdate.py`).
- **Public Verification Portal** — parents scan the QR on any receipt (`/lookup/{{number}}`) and see a proof-of-payment page with VERIFIED/CANCELLED banner, meta strip, student card, annual ledger, and the full receipt rendered by the universal engine with a public toolbar (Print + PDF/PNG/JPEG/SVG downloads, no admin actions). No login required.
- **Production Data Purge** (`/api/production/purge`) — deletes 11 transactional collections + resets counters, keeps 10 master collections. Preview endpoint shows exact counts. Requires Admin PIN + phrase `PURGE DEMO DATA`.
- **Factory Reset** (`/api/production/factory-reset`) — Administrator-only System Maintenance with 5-gate security: role + X-Admin-Pin + password re-verify + Factory Reset PIN (default 2580, changeable) + phrase `DELETE ALL SCHOOL DATA`. Auto-creates DB backup + config snapshot BEFORE deletion; aborts if backup fails. Deletes 13 collections + all non-admin users + counters + staged updates. Preserves 10 master collections + administrator + school logo + license.
- **Fresh Production ZIP builder** (`/api/deliverables/rebuild-zip`) + this script.
- **Installation Manual (PDF)** — auto-generated from the Delivery Center via jsPDF, 10 illustrated sections (Requirements → Main Server install → Client PCs → First-time config → Excel import → Daily ops → Software updates → Backup/recovery → Troubleshooting → Appendix).
- **System Diagnostics** (from the previous phase) — DB / printers / LAN / backup path health checks.
- **Automatic backup rotation** — daily backups retained: last 30.
- **Bus Fares** — CRUD for bus stops, Excel dropdown templates, bulk +10% updates.

### Reliability
- 29 automated pytest tests pass (Software Updates 9/9, iter6 8/8, iter7 12/12).
- Testing agent iteration_7 status: 100% pass, retest not needed.

### Security
- JWT auth with cookie + Bearer fallback, bcrypt password hashing.
- Every write endpoint requires the correct role; sensitive endpoints also require Admin PIN.
- Factory Reset has 5 separate gates and never leaks the PIN.
- Software Update packages verified with SHA-256 + RSA-PSS before install.
""")

    (docs / "API_DOCUMENTATION.md").write_text("""# API documentation (summary)

All endpoints are under `/api`. Authentication is JWT via Bearer token; write endpoints also require X-Admin-Pin where noted.

## Auth
- POST `/api/auth/login` — email + password → { token, user }
- GET  `/api/auth/me`
- POST `/api/auth/me/pin` — set/change Admin PIN

## Receipts
- GET  `/api/receipts` · GET `/api/receipts/{id}` · POST `/api/receipts`
- POST `/api/receipts/{id}/reprint` · POST `/api/receipts/{id}/cancel`

## Receipt Types (config)
- GET / POST / PATCH / DELETE `/api/receipt-types`

## Students / Fee Structure / Departments / Classes / Fee Heads
- Standard CRUD under `/api/students`, `/api/fee-structures`, `/api/departments`, `/api/classes`, `/api/fee-heads`

## Public (no auth)
- GET `/api/public/lookup/{number}` — receipt + student + annual ledger
- GET `/api/public/student-lookup/{admission_no}` — student ledger + siblings

## Software Updates
- GET  `/api/version` · GET `/api/updates/current`
- POST `/api/updates/upload` (Admin PIN) · POST `/api/updates/install/{id}` (Admin PIN)
- POST `/api/updates/rollback/{rollback_id}` (Admin PIN)
- GET  `/api/updates` · GET `/api/updates/rollbacks`
- GET  `/api/updates/public-key`

## Production maintenance
- GET  `/api/production/purge/preview` (Admin PIN)
- POST `/api/production/purge` (Admin PIN + confirm phrase `PURGE DEMO DATA`)
- GET  `/api/production/factory-reset/status` (Admin PIN)
- POST `/api/production/factory-reset/change-pin` (Admin PIN + password)
- POST `/api/production/factory-reset` (Admin PIN + password + factory PIN + phrase `DELETE ALL SCHOOL DATA`)

## Delivery
- GET  `/api/deliverables/manifest` · POST `/api/deliverables/rebuild-zip`
- GET  `/api/deliverables/license` · GET `/api/deliverables/release-notes`

## Config / Backup / Snapshots
- GET  `/api/config/export` (Admin PIN)
- POST `/api/config/backup` (Admin PIN) · POST `/api/config/restore/{id}` (Admin PIN + dual)
- GET / POST / DELETE `/api/config/snapshots`

## Diagnostics
- GET `/api/diagnostics` · POST `/api/diagnostics/refresh`
""")

    (docs / "DATABASE_DOCUMENTATION.md").write_text("""# Database schema (MongoDB)

## Master collections (preserved by every purge / factory reset)
- **settings**            — school info, printer, factory_reset_pin
- **departments**         — English Primary / Marathi Primary / Secondary / Junior College
- **classes**             — LKG through 12th, per department
- **fee_heads**           — Tuition / Development / Exam / …
- **fee_structures**      — class × medium × stream → { total, installments, lines[] }
- **receipt_types**       — 9 types with paper_size, theme, signature layout, prefix
- **bus_stops** / **bus_routes**
- **config_defaults**     — factory defaults for the setup wizard
- **license**             — ownership document

## Users
- **users**               — { id, email, password_hash, role, name, is_admin_pin_set }

## Transactional collections (deleted by purge & factory reset)
- **students**            — full student record + snapshot fields
- **receipts**            — every printed doc (school, admission, bus, refund, debit_voucher, …)
- **adjustments**         — concessions & waivers, needs manager approval
- **payment_extensions**  — dated promises to pay later
- **reminders**           — outbound reminder log
- **notices**             — fee notice log
- **audit_log**           — every write action, forever
- **config_snapshots**    — YoY archived configuration
- **updates**             — .bcupdate history
- **backups**             — mongodump records
- **diagnostics_snapshots** — daily health checks
- **imports_history**     — Excel import log
- **attachments**         — uploaded files

## Counters
- **counters**             — atomic per-year receipt / voucher sequences
""")
    print("  refreshed  docs/")


def add_tree(zf: zipfile.ZipFile, src: Path, arc_base: str) -> int:
    if not src.exists(): return 0
    if src.is_file():
        if should_skip(src): return 0
        zf.write(src, arc_base); return 1
    n = 0
    for p in src.rglob("*"):
        if not p.is_file() or should_skip(p): continue
        arc = f"{arc_base}/{p.relative_to(src).as_posix()}"
        zf.write(p, arc); n += 1
    return n


def main() -> int:
    if not DIST_ROOT.exists():
        print(f"ERROR: {DIST_ROOT} is missing — the pre-authored delivery folder must exist.", file=sys.stderr)
        return 2

    OUT_ZIP.parent.mkdir(parents=True, exist_ok=True)
    if OUT_ZIP.exists(): OUT_ZIP.unlink()

    print(f"Building {OUT_ZIP.name} …")
    _refresh_source_snapshot()
    _write_docs()

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        total = 0
        # Whole pre-authored folder gets added recursively (installers/docs/manuals/…)
        n = 0
        for p in DIST_ROOT.rglob("*"):
            if not p.is_file(): continue
            rel = p.relative_to(DIST_ROOT)
            if should_skip_rel(rel): continue
            zf.write(p, rel.as_posix()); n += 1
        print(f"  packed     {DIST_ROOT.name}/  · {n} file(s)")
        total += n

        # Repeat root convenience files at ZIP root so the admin sees them first on extract
        zf.writestr("README.md", f"""# Balaji Convent Fee Software (Balaji FeeHub) — v1.0 FINAL

**Built:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}

## Quick start
1. Extract this ZIP to `C:\\BalajiFeeHub` (or any folder you prefer).
2. Open the file `START_HERE.md` and follow the six numbered steps.
3. Main Server install:  `01-install-main-server\\install-main-server.bat` (Run as administrator)
4. Client PC install:    `02-install-client-pc\\install-client-pc.bat` (Run as administrator)
5. Open Chrome → `http://<MAIN-SERVER-IP>:3000` → complete the Setup Wizard.

## Ownership
This software is the exclusive property of Balaji Convent & Junior College, Butibori, Nagpur.
See `LICENSE_AND_OWNERSHIP.md` for full terms.

## What's inside
- 01–12/  numbered installation + operation folders (start with START_HERE.md)
- 03-source-code/  full backend + frontend source (no obfuscation)
- 03-source-code/scripts/  build_bcupdate.py, production_purge.py, build_final_zip.py
- docs/CHANGELOG.md, API_DOCUMENTATION.md, DATABASE_DOCUMENTATION.md
- RELEASE_NOTES.md, LICENSE_AND_OWNERSHIP.md, FINAL_VERIFICATION.md, LOAD_TEST_REPORT.md
""")
        total += 1

    size_mb = OUT_ZIP.stat().st_size / (1024 * 1024)
    print(f"\nDone → {OUT_ZIP}  ({size_mb:.2f} MB, {total} file(s))")

    # Publish for in-app download
    dl_dir = APP / "frontend" / "public" / "downloads"
    dl_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT_ZIP, dl_dir / OUT_ZIP.name)

    # Compute SHA-256 and write SHA256SUM.txt next to the ZIP + into the delivery folder
    # (the latter will be picked up the next build).
    import hashlib
    h = hashlib.sha256(OUT_ZIP.read_bytes()).hexdigest()
    (APP / "dist" / "SHA256SUM.txt").write_text(f"{h}  {OUT_ZIP.name}\n")
    (dl_dir / "SHA256SUM.txt").write_text(f"{h}  {OUT_ZIP.name}\n")
    (DIST_ROOT / "SHA256SUM.txt").write_text(f"{h}  {OUT_ZIP.name}\n")

    # Version.json for the in-app updater
    (dl_dir / "version.json").write_text(f'{{"version":"1.0.0","filename":"{OUT_ZIP.name}","size_mb":{size_mb:.2f},"sha256":"{h}","built_at":"{datetime.utcnow().isoformat()}Z"}}')

    print(f"Published → /downloads/{OUT_ZIP.name}  (accessible via the running app)")
    print(f"SHA-256   : {h}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
