"""
Student Payment Receipt History + 2-session active retention + admin-only
receipt archiving.

ARCHITECTURE (read this before touching anything here):

- There is no canonical "current academic year" setting anywhere in this app
  (confirmed: it's a hard-coded default string repeated across ~15 Pydantic
  models). So "active session" here is DATA-DRIVEN, not calendar-driven, per
  explicit instruction: the set of academic years is the distinct set of
  `academic_year` values actually present on real receipts, sorted
  descending; the top 2 are "active", everything else is "archivable". This
  never reacts to the calendar — only to which years actually have receipts.

- Archiving NEVER deletes or moves anything out of `db.receipts`. Historical
  financial transactions are never deleted, rewritten, or renumbered — full
  stop, matching the rest of this app's financial-safety rules. "Archiving"
  means two additive things only:
    1. A validated, checksummed ZIP snapshot of that year's receipts is
       written to server-side storage (mirrors core.py's own
       `_create_backup_zip`/BACKUP_DIR pattern) for long-term retention.
    2. That academic_year is recorded as archived in `db.receipt_archives`,
       which the STUDENT-FACING history endpoint below uses to exclude it
       from what non-admins (and the normal history view for everyone) can
       see. Admin's separate Receipt Archives screen queries the same
       still-present `db.receipts` rows directly — nothing is duplicated.

- This keeps the feature honest about "never delete historical financial
  transactions merely because they were archived": nothing is ever deleted,
  so the safety rule can never be at risk of being violated by this code.
"""
import hashlib
import io
import json as _json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from core import db, audit, gen_id, get_current_user, now_iso, require_roles, APP_ROOT

router = APIRouter(prefix="/api", tags=["receipt-archives"])

ACTIVE_SESSION_COUNT = 2
RECEIPT_ARCHIVE_DIR = APP_ROOT / "receipt_archives"


# ---------------- Academic-year derivation (data-driven, no calendar) ----------------

async def _all_academic_years() -> List[str]:
    years = await db.receipts.distinct("academic_year")
    years = [y for y in years if y]
    return sorted(years, reverse=True)


async def _active_academic_years() -> List[str]:
    return (await _all_academic_years())[:ACTIVE_SESSION_COUNT]


async def _archivable_academic_years() -> List[str]:
    """Years beyond the active-2 window that don't yet have a VALID archive."""
    all_years = await _all_academic_years()
    beyond_window = all_years[ACTIVE_SESSION_COUNT:]
    if not beyond_window:
        return []
    already_valid = set(await db.receipt_archives.distinct("academic_year", {"status": "valid"}))
    return [y for y in beyond_window if y not in already_valid]


# ---------------- Archive creation + validation (Part 5) ----------------

async def _build_and_validate_archive(academic_year: str, actor: dict) -> Dict[str, Any]:
    """Creates the ZIP, validates it against the source data, records the
    result (valid or failed) in db.receipt_archives, and audits the outcome.
    Never touches db.receipts. Idempotent: caller (_run_archive_check) only
    invokes this for years without an existing valid archive."""
    archive_id = gen_id()
    now = now_iso()
    try:
        record = await _do_build_and_validate(academic_year, archive_id, now, actor)
    except Exception as e:
        # Never remove/touch source data on failure — just record and audit it,
        # so the operation can be safely retried later.
        record = {
            "id": archive_id, "academic_year": academic_year, "filename": None, "path": None,
            "size_bytes": None, "checksum_sha256": None, "receipt_count": None, "total_amount": None,
            "created_at": now, "created_by": actor.get("name"), "created_by_id": actor.get("id"),
            "status": "failed", "error": str(e),
        }
        await db.receipt_archives.insert_one(record.copy())
        await audit(actor, "receipt_archive_create", "receipt_archive", archive_id, {
            "academic_year": academic_year, "result": "failed", "error": str(e),
        })
        return {k: v for k, v in record.items() if k != "_id"}

    # DB insert + audit happen OUTSIDE the build/validate try above, so a
    # hiccup in either can never relabel a genuinely successful, already-
    # validated archive as "failed" (which would risk a duplicate/conflicting
    # record for the same academic_year).
    await db.receipt_archives.insert_one(record.copy())
    await audit(actor, "receipt_archive_create", "receipt_archive", archive_id, {
        "academic_year": academic_year, "receipt_count": record["receipt_count"],
        "total_amount": record["total_amount"], "filename": record["filename"], "result": "success",
    })
    return {k: v for k, v in record.items() if k != "_id"}


async def _do_build_and_validate(academic_year: str, archive_id: str, now: str, actor: dict) -> Dict[str, Any]:
    """The actual file-creation + validation work (Part 5, steps 1-8). Raises
    on any failure; returns the ready-to-insert 'valid' record dict on
    success. Caller handles persistence/audit so a downstream failure there
    is never confused with an archive-build failure."""
    if True:
        RECEIPT_ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        year_dir = RECEIPT_ARCHIVE_DIR / academic_year
        year_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
        fname = f"BalajiConvent-Receipts-{academic_year}-{ts}.zip"
        path = year_dir / fname

        source_receipts = await db.receipts.find({"academic_year": academic_year}, {"_id": 0}).to_list(200000)
        receipt_ids = [r["id"] for r in source_receipts]
        source_count = len(source_receipts)
        source_numbers = sorted(r.get("number") for r in source_receipts)
        source_total = round(sum(float(r.get("total") or 0) for r in source_receipts if r.get("status") != "cancelled"), 2)

        # Relevant audit trail for these exact receipts (create/cancel/reprint) —
        # preserved for reconstructing history, never used to rewrite anything.
        audit_rows = await db.audit_log.find(
            {"entity": "receipt", "entity_id": {"$in": receipt_ids}}, {"_id": 0}
        ).to_list(200000) if receipt_ids else []

        manifest = {
            "id": archive_id, "academic_year": academic_year, "created_at": now,
            "created_by": actor.get("name"), "receipt_count": source_count,
            "total_amount": source_total, "app_version": "1.0.0",
        }
        hasher = hashlib.sha256()
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            payload = _json.dumps(source_receipts, default=str)
            zf.writestr("receipts.json", payload)
            hasher.update(payload.encode())
            audit_payload = _json.dumps(audit_rows, default=str)
            zf.writestr("audit_log.json", audit_payload)
            hasher.update(audit_payload.encode())
            zf.writestr("manifest.json", _json.dumps(manifest, indent=2, default=str))

        # ---- Validation (Part 5, steps 2-8) ----
        if not path.exists():
            raise RuntimeError("Archive ZIP was not created on disk")
        with zipfile.ZipFile(path, "r") as zf:
            bad = zf.testzip()
            if bad:
                raise RuntimeError(f"Archive ZIP failed integrity check at {bad}")
            names = set(zf.namelist())
            if not {"receipts.json", "audit_log.json", "manifest.json"} <= names:
                raise RuntimeError(f"Archive ZIP is missing required files (found: {sorted(names)})")
            zip_receipts = _json.loads(zf.read("receipts.json").decode())
            zip_manifest = _json.loads(zf.read("manifest.json").decode())
        if zip_manifest.get("academic_year") != academic_year:
            raise RuntimeError("Archive manifest academic_year does not match source")
        if len(zip_receipts) != source_count:
            raise RuntimeError(f"Archive receipt count mismatch: zip={len(zip_receipts)} source={source_count}")
        zip_total = round(sum(float(r.get("total") or 0) for r in zip_receipts if r.get("status") != "cancelled"), 2)
        if abs(zip_total - source_total) > 0.01:
            raise RuntimeError(f"Archive financial total mismatch: zip={zip_total} source={source_total}")
        zip_numbers = sorted(r.get("number") for r in zip_receipts)
        if zip_numbers != source_numbers:
            raise RuntimeError("Archive receipt numbers do not exactly match the source records")

        size = path.stat().st_size
        record = {
            "id": archive_id, "academic_year": academic_year, "filename": fname,
            "path": str(path), "size_bytes": size, "checksum_sha256": hasher.hexdigest(),
            "receipt_count": source_count, "total_amount": source_total,
            "created_at": now, "created_by": actor.get("name"), "created_by_id": actor.get("id"),
            "status": "valid", "error": None,
        }
        return record


async def _run_archive_check(actor: dict) -> List[Dict[str, Any]]:
    """Idempotent: archives exactly the years that have fallen outside the
    active-2 window and don't already have a valid archive. Safe to call on
    every page load / startup — does nothing when nothing needs archiving,
    and never re-archives (or duplicates) a year that's already valid."""
    to_archive = await _archivable_academic_years()
    results = []
    for year in to_archive:
        results.append(await _build_and_validate_archive(year, actor))
    return results


# ==================== PART 1 — Student Payment Receipt History ====================

@router.get("/students/{sid}/receipt-history")
async def student_receipt_history(
    sid: str,
    academic_year: Optional[str] = None,
    receipt_type: Optional[str] = None,
    payment_mode: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Every receipt for this student from the active 2-session retention
    window — the SAME receipt records used everywhere else in the app
    (db.receipts), never recomputed or duplicated. Receipts from archived
    years are intentionally excluded here for every role, including Admin —
    Admin views those through the separate Receipt Archives screen instead,
    per the explicit requirement that archived data isn't re-exposed through
    the normal student view. Voided receipts remain in this list (status
    'cancelled') so they stay visible with their VOIDED status, never hidden."""
    student = await db.students.find_one({"id": sid}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    classes = {c["id"]: c async for c in db.classes.find({}, {"_id": 0})}
    cls = classes.get(student.get("class_id"), {})
    dept = await db.departments.find_one({"id": student.get("department_id")}, {"_id": 0, "name": 1})

    active_years = await _active_academic_years()
    if academic_year and academic_year not in active_years:
        raise HTTPException(400, f"academic_year must be one of the active sessions: {active_years}")
    years_filter = [academic_year] if academic_year else active_years

    q: Dict[str, Any] = {"student_id": sid, "academic_year": {"$in": years_filter}}
    if receipt_type:
        q["receipt_type"] = receipt_type
    if payment_mode:
        q["payment_mode"] = payment_mode

    receipts = await db.receipts.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    total_paid = round(sum(float(r.get("total") or 0) for r in receipts if r.get("status") != "cancelled"), 2)

    # Archived-year status indicators only — no receipt content, no counts of
    # financial figures, just "this year exists and is archived" so the UI
    # can show the year with an ARCHIVED badge and (for Admin) a link across
    # to the Receipt Archives screen.
    all_years = await _all_academic_years()
    archived_years = [y for y in all_years if y not in active_years]
    valid_archives = {a["academic_year"]: a for a in await db.receipt_archives.find(
        {"academic_year": {"$in": archived_years}, "status": "valid"}, {"_id": 0}
    ).to_list(100)}
    archived_summary = [
        {"academic_year": y, "archived": y in valid_archives, "admin_viewable": user["role"] == "administrator"}
        for y in archived_years
    ]

    return {
        "student": {
            "id": student["id"], "name": student.get("name"), "admission_no": student.get("admission_no"),
            "department_name": dept.get("name") if dept else None,
            "class_name": cls.get("name"), "medium": student.get("medium") or cls.get("medium"),
            "stream": student.get("stream") or cls.get("stream"), "section": student.get("section"),
        },
        "active_academic_years": active_years,
        "filters_applied": {"academic_year": academic_year, "receipt_type": receipt_type, "payment_mode": payment_mode},
        "total_receipts": len(receipts),
        "total_amount_paid": total_paid,
        "receipts": receipts,
        "archived_years": archived_summary,
    }


# ==================== PART 7/8 — Admin-only Receipt Archives ====================

@router.get("/receipt-archives")
async def list_receipt_archives(user=Depends(require_roles("administrator"))):
    """Runs the idempotent archive check first (safe no-op if nothing is due),
    then returns every archive record — this IS the 'automatic archiving'
    trigger: whenever an Admin opens this screen, any session that has
    fallen outside the active-2 window and isn't archived yet gets archived
    right then, data-driven off real receipt years, never off the calendar."""
    await _run_archive_check(user)
    archives = await db.receipt_archives.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    active_years = await _active_academic_years()
    all_years = await _all_academic_years()
    return {
        "active_academic_years": active_years,
        "archivable_academic_years": [y for y in all_years if y not in active_years],
        "archives": archives,
    }


@router.post("/receipt-archives/run")
async def run_receipt_archive(user=Depends(require_roles("administrator"))):
    """Manual trigger for the same idempotent check — for an Admin who wants
    to force a check without opening the list screen. Never re-archives or
    duplicates a year that already has a valid archive."""
    results = await _run_archive_check(user)
    return {"processed": len(results), "results": results}


@router.get("/receipt-archives/{academic_year}/receipts")
async def search_archived_receipts(
    academic_year: str,
    q: Optional[str] = None,
    receipt_type: Optional[str] = None,
    user=Depends(require_roles("administrator")),
):
    """Admin-only search into an archived year's receipts. Reads directly from
    db.receipts (never deleted, never moved) — never a duplicated copy.
    Opening a result here is read-only; it never creates a transaction."""
    archive = await db.receipt_archives.find_one({"academic_year": academic_year, "status": "valid"}, {"_id": 0})
    if not archive:
        raise HTTPException(404, f"No valid archive found for {academic_year}")

    query: Dict[str, Any] = {"academic_year": academic_year}
    if receipt_type:
        query["receipt_type"] = receipt_type
    if q:
        # re.escape - see students.py's list_students() for the same fix and
        # rationale: literal search text, never executable regex syntax.
        safe_q = re.escape(q)
        query["$or"] = [
            {"number": {"$regex": safe_q, "$options": "i"}},
            {"payer_name": {"$regex": safe_q, "$options": "i"}},
            {"student_snapshot.name": {"$regex": safe_q, "$options": "i"}},
            {"student_snapshot.admission_no": {"$regex": safe_q, "$options": "i"}},
        ]
    receipts = await db.receipts.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    await audit(user, "receipt_archive_search", "receipt_archive", archive["id"], {
        "academic_year": academic_year, "query": q, "receipt_type": receipt_type, "result_count": len(receipts),
    })
    return {"academic_year": academic_year, "archive": archive, "receipts": receipts}


@router.get("/receipt-archives/{academic_year}/download")
async def download_receipt_archive(academic_year: str, user=Depends(require_roles("administrator"))):
    """Streams the validated ZIP. Never served as a static/public file path —
    this is the only way to reach the bytes, and it's Admin-gated at the
    backend, not just hidden from the menu."""
    archive = await db.receipt_archives.find_one({"academic_year": academic_year, "status": "valid"}, {"_id": 0})
    if not archive:
        raise HTTPException(404, f"No valid archive found for {academic_year}")
    path = Path(archive["path"])
    if not path.exists():
        raise HTTPException(410, "Archive file is missing from server storage")
    await audit(user, "receipt_archive_download", "receipt_archive", archive["id"], {"academic_year": academic_year})
    data = path.read_bytes()
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{archive["filename"]}"'},
    )
