"""Balaji Convent Fee Software - Shared core.
DB client, models, deps, utils, admin PIN gates, numbering, seed data.
Kept as a single module so every router can `from core import ...`.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import bcrypt
import jwt
import io
import zipfile
import json as _json
import hashlib
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Any, Dict, Literal
from fastapi import HTTPException, Depends, Request, Header
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

# ---------------- DB ----------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = 'HS256'
ACCESS_MIN = 60 * 12  # 12h for LAN use

# App install root: ROOT_DIR is .../<install>/backend, so its parent is the
# install root on every deployment topology this project uses (Docker's
# /app/backend as well as the Windows installer's C:\balaji-fee\backend).
# APP_ROOT env var lets an operator override this explicitly if ever needed.
APP_ROOT = Path(os.environ.get("APP_ROOT", str(ROOT_DIR.parent)))
BACKUP_DIR = APP_ROOT / "backups"
BACKUP_RETENTION = 30   # keep the most-recent N backups automatically
SETTINGS_ID = "school_settings"
CONFIG_COLLECTIONS = [
    "receipt_types", "departments", "classes", "fee_heads", "fee_structures",
    "settings", "bus_routes", "bus_stops",
]

# ---------------- Medium & class canonicalisation ----------------
# Accepted spellings (case-insensitive) → canonical value.
MEDIUM_ALIASES: Dict[str, str] = {
    "english medium": "English Medium",
    "english":        "English Medium",
    "eng":            "English Medium",
    "em":             "English Medium",
    "semi medium":            "Semi Medium (Marathi)",
    "semi medium (marathi)":  "Semi Medium (Marathi)",
    "semi":                    "Semi Medium (Marathi)",
    "semi-english":            "Semi Medium (Marathi)",
    "semi english":            "Semi Medium (Marathi)",
    "marathi":                 "Semi Medium (Marathi)",
    "marathi (semi)":          "Semi Medium (Marathi)",
    "sm":                      "Semi Medium (Marathi)",
    "junior college": "Junior College",
    "jc":             "Junior College",
    "college":        "Junior College",
    "jr college":     "Junior College",
    "jr. college":    "Junior College",
}
JC_STREAMS = {"arts", "commerce", "science", "bi-focal", "bifocal", "bi focal", "electronics", "fisheries", "sci fisheries", "sci. fisheries"}
JC_STREAM_CANONICAL = {
    "arts": "Arts", "commerce": "Commerce", "science": "Science",
    # "Bi-Focal" is the correct name (matches the Junior College department's
    # own header text "ARTS, COMMERCE, SCIENCE & BI-FOCAL" and the
    # authoritative FeeHub_Receipt_Types.pdf mapping already encoded in
    # eligible_receipt_codes_for_class() below). "electronics" and every
    # "fisheries" variant are accepted here only as legacy input synonyms so
    # older import files/typed values still canonicalize correctly — neither
    # is ever the stored/displayed value. (Previously "fisheries" mapped to
    # itself instead of "Bi-Focal", which would have let a fresh import
    # re-introduce the non-canonical "Fisheries" stream this app otherwise
    # fully migrated away from — fixed here, not just for existing records.)
    "bi-focal": "Bi-Focal", "bifocal": "Bi-Focal", "bi focal": "Bi-Focal", "electronics": "Bi-Focal",
    "fisheries": "Bi-Focal", "sci fisheries": "Bi-Focal", "sci. fisheries": "Bi-Focal",
}

def canonical_medium(raw: str) -> Optional[str]:
    if not raw: return None
    return MEDIUM_ALIASES.get(raw.strip().lower())

def canonical_stream(raw: str) -> Optional[str]:
    if not raw: return None
    return JC_STREAM_CANONICAL.get(raw.strip().lower())

# ---------------- Fee-structure resolver ----------------
async def resolve_fee_structure(medium: str, class_name: str, stream: Optional[str] = None,
                                 first_year_in_college: bool = False,
                                 academic_year: str = "2026-27") -> Optional[dict]:
    """Deterministic (medium, class_name, stream, applies_to) → fee structure lookup.
    Admission Fee and Continuation Fee are alternatives, never charged together - so any class
    that has a real continuation fee is seeded as a new_only/returning_only PAIR (never one row
    combining both). Whenever a pair exists for this (medium, class, stream), `first_year_in_college`
    picks new_only vs returning_only. A class with no such duality (e.g. Nursery - nobody
    continues INTO Nursery) is seeded as a single 'all' row and returned regardless of the flag."""
    q: Dict[str, Any] = {"medium": medium, "class_name": class_name, "academic_year": academic_year}
    if stream:
        q["stream"] = stream
    matches = await db.fee_structures.find(q, {"_id": 0}).to_list(20)
    if not matches:
        return None
    by_applies = {m.get("applies_to", "all"): m for m in matches}
    if "new_only" in by_applies and "returning_only" in by_applies:
        return by_applies["new_only"] if first_year_in_college else by_applies["returning_only"]
    for m in matches:
        if m.get("applies_to", "all") == "all":
            return m
    return matches[0]

def normalize_class_name(raw: str) -> str:
    """Turn '5th', '5th Std', 'Class 5' etc. into 'Class 5' — a very forgiving mapper.
    Preserves K.G. I / K.G. II / Nursery / Shishuvihar / Balwadi variants as-is."""
    if not raw: return raw
    r = raw.strip()
    lower = r.lower()
    kg_map = {"kg i": "K.G. I", "kgi": "K.G. I", "kg-i": "K.G. I", "kg 1": "K.G. I",
              "kg ii": "K.G. II", "kgii": "K.G. II", "kg-ii": "K.G. II", "kg 2": "K.G. II"}
    if lower in kg_map: return kg_map[lower]
    ordinal_map = {"1st":"1","2nd":"2","3rd":"3","4th":"4","5th":"5","6th":"6",
                   "7th":"7","8th":"8","9th":"9","10th":"10","11th":"11","12th":"12"}
    for ordinal, num in ordinal_map.items():
        if lower.startswith(ordinal + " ") or lower == ordinal + " std" or lower == ordinal:
            return f"Class {num}"
    if lower.startswith("class "):
        return "Class " + r.split(" ", 1)[1].strip()
    return r

# ---------------- Utils ----------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def gen_id() -> str:
    return str(uuid.uuid4())

# -----------------------------------------------------------------------------
# Receipt eligibility engine — SINGLE SOURCE OF TRUTH for which receipt type(s)
# a student's actual class/medium/stream qualifies for, per the authoritative
# FeeHub_Receipt_Types.pdf mapping. Used by: receipt creation validation
# (routers/receipts.py), the eligible-receipt-types lookup endpoint (routers/
# students.py), and CSV export — so the same rule can never drift between
# those three call sites. Pure function: no DB access, no side effects.
#
# Deliberately does NOT decide BUS or EMJC/DV — those are handled by callers:
#   BUS depends on the student's bus_required flag, not class/medium/stream.
#   EMJC is intentionally broad-by-design (per its own applicable_dept_codes
#     in the receipt_types collection) and must never be auto-preferred over
#     a more specific match — callers should treat it as an always-available
#     manual alternative, never the auto-suggested primary.
#   DV (Debit Voucher) is Finance/Petty Cash, not a student academic receipt.
# -----------------------------------------------------------------------------
import re as _re

def _class_number(class_name: str):
    """Extract the numeric class from a name like 'Class 5' / 'Class 11 - Science'. None if not numeric (Nursery, KG, Shishuvihar, etc.)."""
    m = _re.search(r"class\s*(\d+)", (class_name or ""), _re.IGNORECASE)
    return int(m.group(1)) if m else None

def eligible_receipt_codes_for_class(class_name: str, medium: str, stream: str = None):
    """
    Returns (eligible_codes: list[str], notes: list[str]) based purely on the
    authoritative mapping. Does not know about department scoping or bus
    status — callers intersect with receipt_types.applicable_dept_codes and
    layer on the bus_required check separately.
    """
    cn = (class_name or "").strip().lower()
    med = (medium or "").strip().lower()
    st = (stream or "").strip().lower()
    n = _class_number(class_name)
    eligible = []
    notes = []

    # EP — Nursery, K.G.1, K.G.2 only (not a class-number range)
    if cn in ("nursery", "k.g.1", "kg 1", "kg i", "kg1", "lkg",
              "k.g.2", "kg 2", "kg ii", "kg2", "ukg"):
        eligible.append("EP")

    # MP — Shishuvihar/Balwadi by name, or Classes 1-8 Marathi Medium
    if cn in ("senior shishuvihar", "junior shishuvihar", "balwadi"):
        eligible.append("MP")
    elif n is not None and 1 <= n <= 8 and "marathi" in med:
        eligible.append("MP")

    # EMP — Classes 1-10 English Medium
    if n is not None and 1 <= n <= 10 and "english" in med:
        eligible.append("EMP")

    # SEC — Classes 9 & 10 Marathi Medium
    if n is not None and n in (9, 10) and "marathi" in med:
        eligible.append("SEC")

    # JC / JCACS — Classes 11 & 12. JC is the school-wide rule for ALL Class
    # 11/12 students regardless of stream (Arts/Commerce/Science/Bi-Focal or
    # anything else) — the Student Profile -> New Receipt flow always routes
    # here. JCACS is ADDITIONALLY eligible for the four canonical streams so
    # it stays valid for manual selection and any existing/historical
    # receipts filed under it — it is never removed, just no longer the
    # default. "electronics"/"fisheries" are matched too as a defensive
    # legacy fallback (old data occasionally used those labels before they
    # were corrected to "Bi-Focal") so this never regresses even if a stray
    # value slips through elsewhere.
    if n is not None and n in (11, 12):
        eligible.append("JC")
        if st in ("arts", "commerce", "science", "bifocal", "bi-focal", "bi focal", "electronics", "fisheries"):
            eligible.append("JCACS")
        elif st:
            notes.append(f"stream '{stream}' is not one of the PDF's listed JCACS streams (Arts/Commerce/Science/Bi-Focal) — JC applies")

    return eligible, notes

# -----------------------------------------------------------------------------
# Per-student fee/installment overrides (Option A — approved). A student_fee_
# overrides document says "for THIS student, THIS academic year, THIS fee
# head, the total is X, optionally split into 1-4 installments with due
# dates" — layered on top of the shared fee_structures.items[] the rest of
# the school uses. Payment itself is completely unchanged: a cashier still
# just pays against a named fee_head_name line via the existing
# create_receipt() path, and paid/outstanding is still derived live from real
# receipts (never a stored, independently-editable status) - this function
# only decides WHICH items (shared or overridden) a student's ledger shows.
# -----------------------------------------------------------------------------
def validate_installments(total_amount: float, installments: list):
    """Raises ValueError with a clear message on any problem. Returns nothing on success."""
    if not (1 <= len(installments) <= 4):
        raise ValueError("Between 1 and 4 installments are required")
    total = 0.0
    for idx, inst in enumerate(installments):
        try:
            amt = float(inst.get("amount"))
        except (TypeError, ValueError, AttributeError):
            raise ValueError(f"Installment {idx+1}: amount must be a number")
        if amt <= 0:
            raise ValueError(f"Installment {idx+1}: amount must be positive")
        due = str(inst.get("due_date") or "").strip()
        if not due:
            raise ValueError(f"Installment {idx+1}: due date is required")
        total += amt
    if abs(total - float(total_amount)) > 0.01:
        raise ValueError(f"Installment amounts (₹{total:,.2f}) must total exactly the fee amount (₹{float(total_amount):,.2f})")

def compute_fee_items(fs_items: list, overrides: list, receipts: list) -> list:
    """The SINGLE shared computation of 'what does this student owe, per fee
    head/installment' — used by the student ledger endpoint, the Live Fee
    Update listing, and CSV export, so there is exactly one place this logic
    lives (never three copies that could drift apart). Pure function: no DB
    access. paid/outstanding/status are always derived from `receipts`
    (real, already-created receipt documents) — never a stored status field.
    """
    overridden_kinds = set()
    overridden_names = set()
    for ov in overrides:
        head_norm = (ov.get("fee_head_name") or "").strip().lower()
        overridden_names.add(head_norm)
        overridden_kinds.add(head_norm[:-4].strip() if head_norm.endswith(" fee") else head_norm)

    paid_by_name: Dict[str, float] = {}
    for r in receipts:
        if r.get("receipt_type") in ("refund", "debit_voucher"):
            continue
        for line in (r.get("lines") or []):
            key = (line.get("fee_head_name") or "").strip().lower()
            paid_by_name[key] = paid_by_name.get(key, 0) + float(line.get("amount") or 0)

    def _status(total: float, paid: float) -> str:
        if total > 0 and paid >= total - 0.01: return "paid"
        if paid > 0: return "partial"
        return "unpaid"

    fee_items = []
    for it in (fs_items or []):
        kind_norm = (it.get("kind") or "").strip().lower()
        name_norm = (it.get("fee_head_name") or "").strip().lower()
        if (kind_norm and kind_norm in overridden_kinds) or name_norm in overridden_names:
            continue
        total = float(it.get("amount") or 0)
        paid = paid_by_name.get(name_norm, 0)
        fee_items.append({
            "fee_head_name": it.get("fee_head_name"), "total": total, "paid": paid,
            "outstanding": max(0, round(total - paid, 2)), "due_date": it.get("due_date"),
            "installment_no": None, "status": _status(total, paid), "source": "shared",
        })
    for ov in overrides:
        if ov.get("installments"):
            for inst in ov["installments"]:
                label = f"{ov['fee_head_name']} - Installment {inst['installment_no']}"
                total = float(inst["amount"])
                paid = paid_by_name.get(label.strip().lower(), 0)
                fee_items.append({
                    "fee_head_name": label, "total": total, "paid": paid,
                    "outstanding": max(0, round(total - paid, 2)), "due_date": inst.get("due_date"),
                    "installment_no": inst["installment_no"], "status": _status(total, paid), "source": "override",
                })
        else:
            total = float(ov["total_amount"])
            paid = paid_by_name.get(ov["fee_head_name"].strip().lower(), 0)
            fee_items.append({
                "fee_head_name": ov["fee_head_name"], "total": total, "paid": paid,
                "outstanding": max(0, round(total - paid, 2)), "due_date": None,
                "installment_no": None, "status": _status(total, paid), "source": "override",
            })
    return fee_items

def apply_opening_paid(fee_items: list, opening_paid: float):
    """Fills a pre-go-live opening-paid amount (from the fee_details
    collection — a real, admin-verified figure imported with a per-row audit
    trail, NEVER a fake receipt) into a per-head fee_items breakdown,
    oldest/first head first, until exhausted. Returns (adjusted_items,
    unabsorbed_remainder) — the remainder is never dropped, the caller adds
    it at the ledger-total level, so the headline "Paid" figure always equals
    live-receipts-paid + the full opening_paid even if it doesn't fit inside
    current heads (e.g. the fee structure changed since the historical
    payment). Shared by the student ledger and the Live Fee Update grid so
    both screens agree on the same student's paid amount."""
    remaining = float(opening_paid or 0)
    out = []
    for it in fee_items:
        it = dict(it)
        if remaining > 0.004 and it["outstanding"] > 0:
            take = min(remaining, it["outstanding"])
            it["paid"] = round(it["paid"] + take, 2)
            it["outstanding"] = round(it["outstanding"] - take, 2)
            it["status"] = "paid" if it["outstanding"] <= 0.01 else ("partial" if it["paid"] > 0 else "unpaid")
            remaining -= take
        out.append(it)
    return out, max(0.0, round(remaining, 2))

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str, token_version: int = 0) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role, "tv": token_version,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_MIN),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def clean(doc: dict) -> dict:
    if not doc: return doc
    doc.pop('_id', None)
    doc.pop('password_hash', None)
    doc.pop('pin_hash', None)
    return doc

def _extract_token(request: Request) -> Optional[str]:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token

# ---------------- Auth deps ----------------
async def get_current_user(request: Request) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(401, "User not found")
    if not user.get("active", True):
        raise HTTPException(401, "Account disabled")
    # Session revocation: logout (and any future forced-revocation action) bumps
    # the user's token_version, which invalidates every token issued before that
    # point - even ones still within their normal expiry window. A token issued
    # before this field existed has no "tv" claim, which defaults to 0 and matches
    # a user with no token_version field yet (also defaults to 0), so upgrading to
    # this check does not retroactively log anyone out.
    if payload.get("tv", 0) != user.get("token_version", 0):
        raise HTTPException(401, "Session expired, please log in again")
    return clean(user)

async def revoke_current_session(request: Request) -> None:
    """Best-effort session revocation for logout: if the request carries a token
    (even one already expired), bump that user's token_version so it - and any
    other outstanding token for that user - is rejected by get_current_user from
    now on. Never raises: logout must always succeed from the caller's point of
    view even if there was no valid token to revoke in the first place."""
    token = _extract_token(request)
    if not token:
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO], options={"verify_exp": False})
        await db.users.update_one({"id": payload["sub"]}, {"$inc": {"token_version": 1}})
    except Exception:
        pass

def _local_machine_ips() -> set:
    """The Main Server's own IP addresses (loopback + every real NIC address), computed once
    at import time. Used to tell 'a request from this PC' apart from 'a request that arrived
    over the LAN from a Client PC', even though both hit the same backend process/port."""
    import socket
    ips = {"127.0.0.1", "::1", "localhost"}
    try:
        hostname = socket.gethostname()
        _, _, addrs = socket.gethostbyname_ex(hostname)
        ips.update(addrs)
    except Exception:
        pass
    try:
        # A UDP "connect" to a public address never sends a packet - it just makes the OS
        # pick the NIC/IP that would be used, which reliably finds the real LAN IP even on
        # machines with multiple adapters or an unhelpful /etc/hosts entry.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ips.add(s.getsockname()[0])
        finally:
            s.close()
    except Exception:
        pass
    return ips

SERVER_LOCAL_IPS = _local_machine_ips()

def is_server_local_request(request: Request) -> bool:
    client_ip = request.client.host if request.client else None
    return client_ip in SERVER_LOCAL_IPS

def require_roles(*roles: str):
    async def _dep(user = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(roles)}")
        return user
    return _dep

async def audit(user: dict, action: str, entity: str, entity_id: str = "", details: dict = None):
    await db.audit_log.insert_one({
        "id": gen_id(), "user_id": user["id"], "user_email": user["email"],
        "user_role": user["role"], "action": action, "entity": entity,
        "entity_id": entity_id, "details": details or {}, "timestamp": now_iso(),
    })

# ---------------- Admin PIN gates ----------------
async def require_admin_pin(x_admin_pin: Optional[str] = Header(None), user = Depends(require_roles("administrator"))):
    if not x_admin_pin:
        raise HTTPException(401, "Administrator PIN required")
    current = await db.users.find_one({"id": user["id"]})
    if not current.get("pin_hash"):
        raise HTTPException(400, "Set your Administrator PIN in My Profile first.")
    if not verify_password(x_admin_pin, current["pin_hash"]):
        await audit(user, "admin_pin_fail", "auth", user["id"], {"event": "invalid_pin"})
        raise HTTPException(403, "Invalid administrator PIN")
    return user

async def require_admin_dual(
    x_admin_pin: Optional[str] = Header(None),
    x_admin_password: Optional[str] = Header(None),
    user = Depends(require_roles("administrator")),
):
    if not x_admin_pin or not x_admin_password:
        raise HTTPException(401, "Administrator PIN and password required for this action")
    current = await db.users.find_one({"id": user["id"]})
    if not current.get("pin_hash") or not verify_password(x_admin_pin, current["pin_hash"]):
        await audit(user, "admin_dual_fail", "auth", user["id"], {"event": "invalid_pin"})
        raise HTTPException(403, "Invalid administrator PIN")
    if not verify_password(x_admin_password, current["password_hash"]):
        await audit(user, "admin_dual_fail", "auth", user["id"], {"event": "invalid_password"})
        raise HTTPException(403, "Invalid administrator password")
    return user

# ---------------- Receipt deletion PIN gate ----------------
# A fixed, hashed, system-wide second factor for the one genuinely destructive
# receipt operation (hard delete, as opposed to cancel/void which keeps the
# record). Deliberately NOT stored on the `settings` document - /api/settings
# (routers/auth.py: read_settings) returns that whole document to any
# authenticated user, which would leak this hash to every role. Stored instead
# in its own collection that no GET route anywhere ever returns. Never logs
# the PIN itself - only the pass/fail outcome and a reason code.
RECEIPT_DELETE_PIN_DOC_ID = "receipt_delete_pin"

async def require_receipt_delete_pin(
    rid: str,
    x_receipt_delete_pin: Optional[str] = Header(None),
    user = Depends(require_roles("administrator", "manager")),
):
    doc = await db.security_config.find_one({"id": RECEIPT_DELETE_PIN_DOC_ID})
    if not doc or not doc.get("pin_hash"):
        await audit(user, "receipt_delete_failed", "receipt", rid, {"reason": "pin_not_configured"})
        raise HTTPException(500, "Receipt deletion PIN is not configured on the server")
    if not x_receipt_delete_pin:
        await audit(user, "receipt_delete_failed", "receipt", rid, {"reason": "missing_pin"})
        raise HTTPException(401, "Deletion PIN required")
    if not verify_password(x_receipt_delete_pin, doc["pin_hash"]):
        await audit(user, "receipt_delete_failed", "receipt", rid, {"reason": "invalid_pin"})
        raise HTTPException(403, "Invalid deletion PIN")
    return user

# ---------------- Fee-edit access approval PIN gate ----------------
# Reuses the SAME system-wide Master PIN/hash as require_receipt_delete_pin
# above (RECEIPT_DELETE_PIN_DOC_ID) - deliberately never a second, separate
# PIN to configure/remember. Only the header name and audit action differ so
# the audit trail reads clearly for this action.
async def require_fee_edit_access_pin(
    req_id: str,
    x_fee_edit_access_pin: Optional[str] = Header(None),
    user = Depends(require_roles("administrator", "manager")),
):
    doc = await db.security_config.find_one({"id": RECEIPT_DELETE_PIN_DOC_ID})
    if not doc or not doc.get("pin_hash"):
        await audit(user, "fee_edit_access_approve_failed", "fee_edit_access", req_id, {"reason": "pin_not_configured"})
        raise HTTPException(500, "Master PIN is not configured on the server")
    if not x_fee_edit_access_pin:
        await audit(user, "fee_edit_access_approve_failed", "fee_edit_access", req_id, {"reason": "missing_pin"})
        raise HTTPException(401, "Master PIN required")
    if not verify_password(x_fee_edit_access_pin, doc["pin_hash"]):
        await audit(user, "fee_edit_access_approve_failed", "fee_edit_access", req_id, {"reason": "invalid_pin"})
        raise HTTPException(403, "Invalid Master PIN")
    return user

# ---------------- Settings helpers ----------------
async def get_settings_doc():
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if not doc:
        doc = {
            "id": SETTINGS_ID,
            "school_name": "Balaji Convent",
            "school_address": "Teacher's Colony, Butibori, Nagpur-441108",
            "school_phone": "9765861493",
            "school_email": "balajiconventjuniorcollege@gmail.com",
            "school_website": "",
            "receipt_footer": "This is a computer-generated receipt.",
            "notice_footer": "Fee counter timing: 9:00 AM – 3:00 PM (Monday to Saturday). Modes accepted: Cash / Cheque / DD / UPI / NEFT.",
            "bus_annual_months": 12,
            "q1_due_date": "2026-06-30",
            "q2_due_date": "2026-09-30",
            "q3_due_date": "2026-12-31",
            "reminder_lead_days": 7,
            "manager_waiver_cap": 5000,
        }
        await db.settings.insert_one(dict(doc))
    doc.pop("_id", None)
    # Option E receipt-printer configuration — additive fields, safe defaults so
    # existing settings documents (created before this feature existed) still
    # work without a migration. Nothing in the current print flow reads these
    # yet; they only take effect once the dedicated receipt-print path (not yet
    # activated) is wired up.
    doc.setdefault("receipt_printer_name", "")
    doc.setdefault("receipt_paper_width_mm", 210.0)
    doc.setdefault("receipt_paper_height_mm", 142.8)
    doc.setdefault("receipt_orientation", "landscape")
    doc.setdefault("receipt_printer_verified", False)
    doc.setdefault("receipt_printer_verified_at", None)
    doc.setdefault("receipt_printer_verified_by", None)
    return doc

# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Literal["cashier", "accountant", "manager", "administrator"]
    department_id: Optional[str] = None

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None

class PinSetIn(BaseModel):
    new_pin: str
    current_password: Optional[str] = None
    current_pin: Optional[str] = None

class PinVerifyIn(BaseModel):
    pin: str

class DepartmentIn(BaseModel):
    name: str
    code: str
    academic_year: str = "2026-27"

class ReceiptTypeIn(BaseModel):
    code: str
    name: str
    department_name: Optional[str] = None
    department_id: Optional[str] = None
    category: Literal["school","bus","finance","misc"] = "school"
    description: Optional[str] = None
    icon: Optional[str] = None
    display_order: int = 100
    enabled: bool = True
    archived: bool = False
    tabs: List[str] = ["school","installment","misc"]
    default_payment_modes: List[str] = ["cash","upi","card"]
    print_template: str = "a4-navy"
    report_category: Optional[str] = None
    notes: Optional[str] = None
    paper_size: Literal["A4","A5","A5_LANDSCAPE","A4_LANDSCAPE","LEGAL","LETTER","Thermal80","THERMAL80"] = "A5"
    orientation: Literal["portrait","landscape"] = "portrait"
    theme: Literal["bw","color"] = "bw"
    signature_layout: Literal["row","grid"] = "row"
    signatures_config: Dict[str, bool] = {"receiver": True, "accountant": True, "principal": True, "director": True}
    margins_mm: Dict[str, int] = {"top": 8, "right": 8, "bottom": 8, "left": 8}
    header_text: Optional[str] = None
    footer_text: Optional[str] = None
    watermark_text: Optional[str] = None
    watermark_enabled: bool = False
    barcode_enabled: bool = False
    qr_enabled: bool = True
    signature_area_enabled: bool = True
    computer_generated_note: str = "This is a computer-generated receipt."
    starting_number: int = 1
    current_number: Optional[int] = None
    auto_reset_yearly: bool = True
    fields: Dict[str, bool] = {
        "admission_no": True, "roll_no": False, "parent_name": True, "mobile": True,
        "class": True, "division": False, "department": True, "academic_year": True,
        "session": False, "fee_head": True, "amount_in_words": True, "payment_mode": True,
        "transaction_id": True, "cashier_name": True, "authorized_by": False, "remarks": True,
    }

class ClassIn(BaseModel):
    department_id: str
    name: str
    section: Optional[str] = None
    medium: Optional[str] = None
    # JC only - Arts/Commerce/Science/Bi-Focal. Canonicalized server-side so
    # this generic admin "New Class" form can never create a non-canonical
    # stream name (e.g. "Fisheries") the way the old seed data once did.
    stream: Optional[str] = None

class FeeHeadIn(BaseModel):
    name: str
    code: str
    category: Literal["school", "admission", "bus", "misc", "general"] = "school"

class FeeStructureIn(BaseModel):
    department_id: str
    class_id: str
    academic_year: str = "2026-27"
    items: List[Dict[str, Any]]

class StudentIn(BaseModel):
    admission_no: str
    name: str
    department_id: str
    class_id: str
    section: Optional[str] = None
    roll_no: Optional[str] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_mobile: Optional[str] = None
    address: Optional[str] = None
    fee_structure_id: Optional[str] = None
    bus_route: Optional[str] = None
    bus_stop_no: Optional[int] = None       # links to bus_stops master list
    bus_stop_name: Optional[str] = None     # denormalised for the receipt
    admission_category: Optional[str] = None
    admission_date: Optional[str] = None
    medium: Optional[str] = None            # canonical: English Medium / Semi Medium (Marathi) / Junior College
    stream: Optional[str] = None            # JC only: Arts / Commerce / Science / Bi-Focal (legacy: Fisheries)
    first_year_in_college: bool = False     # drives "new 12th admission" fee variant

class ReceiptLineIn(BaseModel):
    fee_head_id: Optional[str] = None
    fee_head_name: str
    installment: Optional[str] = None
    amount: float
    note: Optional[str] = None

class ReceiptIn(BaseModel):
    receipt_type: Literal["school","admission","bus","misc","department","general_money","refund","debit_voucher","general_collection"]
    department_id: str
    student_id: Optional[str] = None
    # Explicit cashier choice of which approved receipt TEMPLATE/DESIGN (EP/MP/SEC/
    # JC/JC-ACS/EMP/EMJC/BUS/V) to print this receipt as - distinct from
    # receipt_type above (which drives business rules) and from department_id
    # (which student the money belongs to). Never inferred/guessed.
    receipt_type_id: Optional[str] = None
    payer_name: Optional[str] = None
    purpose: Optional[str] = None
    payment_mode: Literal["cash","cheque","dd","upi","neft","card","other"] = "cash"
    payment_reference: Optional[str] = None
    lines: List[ReceiptLineIn]
    remarks: Optional[str] = None
    linked_receipt_id: Optional[str] = None
    approver_id: Optional[str] = None
    metadata: Dict[str, Any] = {}

class AdjustmentIn(BaseModel):
    student_id: str
    adjustment_type: Literal["scholarship","staff_child","management","financial_assistance","special","correction"]
    amount: float
    reason: str
    fee_head_id: Optional[str] = None

class ExtensionCreateIn(BaseModel):
    """Stage 1 (Cashier): search student -> auto-filled snapshot -> reason -> PRINT.
    No installment amounts are collected here - the printed application shows them
    BLANK, to be hand-written and signed on the physical paper (see ExtensionApproveIn
    for stage 2, where the cashier transcribes the signed paper back into FeeHub)."""
    student_id: str
    reason: str

class ExtensionInstallmentIn(BaseModel):
    amount: float
    due_date: str

class ExtensionApproveIn(BaseModel):
    """Stage 2 (Cashier, after the physically-signed paper returns): the installment
    amounts/dates as actually written and signed by the school authority - never
    invented, never pre-filled. `confirmed` must be explicitly true, mirroring the
    UI's "Signed approval received from school authority?" confirmation."""
    installments: List[ExtensionInstallmentIn]
    confirmed: bool = False

# ---------------- Offline-first client sync ----------------
class DeviceHeartbeatIn(BaseModel):
    """Sent periodically by a Client PC (~30-60s interval, never aggressive)
    so Admin's Connected PCs screen can show real online/offline status. The
    device_id is a UUID the client generates once and persists locally -
    stable across friendly-name renames, app restarts, and even a different
    logged-in user on the same PC."""
    device_id: str
    app_version: Optional[str] = None
    pending_count: int = 0

class DeviceRenameIn(BaseModel):
    friendly_name: str

class SyncOperationIn(BaseModel):
    """One queued offline action. `local_id` is a client-generated UUID and is
    the ONLY thing that makes sync idempotent: retrying the exact same
    local_id (e.g. after a dropped connection mid-sync) must never create a
    second receipt - the server looks it up in `sync_operations` first and
    replays the original result instead of re-applying the operation."""
    local_id: str
    op_type: Literal["create_receipt", "create_expense", "create_bill"]
    payload: Dict[str, Any]
    client_created_at: str

class SyncPushIn(BaseModel):
    device_id: str
    operations: List[SyncOperationIn]

# ---------------- Temporary class-level fee-edit access ----------------
# A Cashier cannot edit fees directly (that stays role-gated to
# administrator/manager/accountant) and is never given the Master PIN. This
# lets a Cashier request a narrow, time-boxed exception instead: a specific
# class/medium + fee scope (school/bus/both), on the requesting PC only,
# approved by an Admin/Manager who enters the Master PIN. Nothing here
# touches the underlying fee-edit endpoint's own business logic - it only
# decides WHO may call it and for WHICH students, for a limited time.
class FeeEditAccessRequestIn(BaseModel):
    device_id: str
    class_id: str
    class_name: Optional[str] = None
    medium: Optional[str] = None
    scope: Literal["school", "bus", "both"]
    reason: str

class FeeEditAccessApproveIn(BaseModel):
    duration_minutes: int = 30

class ReminderFollowupIn(BaseModel):
    reminder_id: str
    remark_type: Literal["will_pay_today","will_pay_tomorrow","contacted","not_reachable","visited","payment_received","other"]
    details: Optional[str] = None

class PromoteIn(BaseModel):
    from_class_id: str
    to_class_id: str
    to_fee_structure_id: Optional[str] = None
    new_academic_year: Optional[str] = None
    section: Optional[str] = None

class RolloverIn(BaseModel):
    from_academic_year: str
    to_academic_year: str

class BusStopIn(BaseModel):
    name: str
    monthly_fee: float

class BusRouteIn(BaseModel):
    name: str
    code: str
    driver_name: Optional[str] = None
    driver_mobile: Optional[str] = None
    vehicle_no: Optional[str] = None
    monthly_fee: float = 0
    stops: List[BusStopIn] = []
    active: bool = True

# ---------------- Numbering ----------------
async def next_receipt_number(dept_code: str, academic_year: str) -> str:
    key = f"{dept_code}-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    if not doc:
        doc = await db.counters.find_one({"key": key})
    seq = doc.get("seq", 1) if doc else 1
    return f"{dept_code}-{academic_year.split('-')[0]}-{seq:06d}"

async def next_receipt_number_by_prefix(prefix: str, academic_year: str) -> str:
    key = f"RT-{prefix}-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"{prefix}-{academic_year.split('-')[0]}-{seq:06d}"

async def next_voucher_number(academic_year: str) -> str:
    key = f"VCH-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"DV-{academic_year.split('-')[0]}-{seq:06d}"

async def next_fee_adjustment_number(academic_year: str) -> str:
    """FA-2026-00001 - permanent, unique, never reused, never reset by re-running an import.
    A student applying again next year gets a fresh number under that year's own sequence;
    the old application is never touched."""
    key = f"FA-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"FA-{academic_year.split('-')[0]}-{seq:05d}"

async def next_expense_number(academic_year: str) -> str:
    """EXP-2026-00001 - a fully independent counter key/sequence from receipts,
    vouchers and FA numbers, so the new Expense module can never collide with
    or consume any existing receipt-numbering sequence."""
    key = f"EXP-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"EXP-{academic_year.split('-')[0]}-{seq:05d}"

async def next_bill_number(academic_year: str) -> str:
    """BILL-2026-00001 - independent counter, same reasoning as next_expense_number.
    Bill Entry is a separate accounting/document-record module; it must never
    touch or reuse the receipt/expense numbering sequences."""
    key = f"BILL-{academic_year}"
    doc = await db.counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"BILL-{academic_year.split('-')[0]}-{seq:05d}"

def amount_in_words_inr(n: float) -> str:
    n = int(round(n))
    if n == 0: return "Zero Rupees Only"
    ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"]
    tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"]
    def two(x):
        if x < 20: return ones[x]
        return tens[x//10] + (" " + ones[x%10] if x%10 else "")
    def three(x):
        h, r = divmod(x, 100)
        s = (ones[h] + " Hundred" + (" " + two(r) if r else "")) if h else two(r)
        return s
    parts = []
    crore = n // 10000000; n %= 10000000
    lakh  = n // 100000;   n %= 100000
    thou  = n // 1000;     n %= 1000
    rest  = n
    if crore: parts.append(three(crore) + " Crore")
    if lakh:  parts.append(two(lakh) + " Lakh")
    if thou:  parts.append(two(thou) + " Thousand")
    if rest:  parts.append(three(rest))
    return " ".join(parts) + " Rupees Only"

# ---------------- Default receipt-type catalog + seed helpers ----------------
DEFAULT_RECEIPT_TYPES = [
    {"code":"EP",     "name":"Balaji Convent English Primary School",                 "department_name":"English Primary Section",              "category":"school", "description":"Fees for Class 1–4 (English medium)",              "icon":"GraduationCap",   "display_order":10, "tabs":["school","installment","misc"]},
    {"code":"MP",     "name":"Balaji Convent Marathi Primary School",                 "department_name":"Marathi Primary Section",              "category":"school", "description":"Fees for इयत्ता १–४ (मराठी माध्यम)",             "icon":"BookOpen",        "display_order":20, "tabs":["school","installment","misc"]},
    {"code":"EMP",    "name":"Balaji Convent English Primary School",                 "department_name":"English Primary Section (Classes 1-10)", "category":"school", "description":"Fees for Classes 1-10 (English medium)",         "icon":"GraduationCap", "display_order":30, "tabs":["school","installment","misc"]},
    {"code":"SEC",    "name":"Balaji Convent Secondary School (Self Financing)",     "department_name":"Secondary Section",                    "category":"school", "description":"Class 5–10 self-financing",                         "icon":"Award",           "display_order":40, "tabs":["school","installment","misc"]},
    {"code":"JC",     "name":"Balaji Convent Junior College",                          "department_name":"Junior College",                       "category":"school", "description":"XI–XII, all standard streams",                       "icon":"GraduationCap",   "display_order":50, "tabs":["school","installment","misc"]},
    {"code":"JCACS",  "name":"Balaji Convent JC (Arts, Commerce, Science & Bifocal)","department_name":"Junior College — ACS/Bifocal",         "category":"school", "description":"XI–XII with bifocal & specialised streams",         "icon":"Award",           "display_order":60, "tabs":["school","installment","misc"]},
    {"code":"BUS",    "name":"Balaji Convent Bus Receipt",                             "department_name":"School Bus Transport",                 "category":"bus",    "description":"Monthly / termly bus route fees",                    "icon":"Bus",             "display_order":70, "tabs":["school"]},
    {"code":"EMJC",   "name":"Balaji Convent English, Marathi & Junior College",     "department_name":"Combined EM + MP + JC",                "category":"school", "description":"Consolidated receipt across all three sections",     "icon":"ClipboardList",   "display_order":80, "tabs":["school","installment","misc"]},
    {"code":"DV",     "name":"Debit Voucher",                                          "department_name":"Finance / Petty Cash",                 "category":"finance","description":"For expenses, refunds, vendor payments",             "icon":"Wallet",          "display_order":90, "tabs":["school"]},
]

async def _seed_receipt_types_if_empty():
    n = await db.receipt_types.count_documents({})
    if n > 0: return
    depts = {d["code"]: d for d in await db.departments.find({}, {"_id":0}).to_list(50)}
    now = now_iso()
    for t in DEFAULT_RECEIPT_TYPES:
        dept = depts.get(t["code"])
        await db.receipt_types.insert_one({
            "id": gen_id(), **t,
            "department_id": dept["id"] if dept else None,
            "enabled": True, "archived": False,
            "default_payment_modes": ["cash","upi","card"],
            "print_template": "a4-navy", "report_category": t["category"],
            "created_at": now, "updated_at": now,
        })

# ---------------- Backup helper ----------------
async def _create_backup_zip(kind: str, actor_name: str) -> Dict[str, Any]:
    """Dumps every collection as JSON into a ZIP, records metadata, verifies integrity."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    bid = gen_id()
    fname = f"balaji-{kind}-{ts}-v1.0.0.zip"
    path = BACKUP_DIR / fname
    known_colls = CONFIG_COLLECTIONS + [
        "users", "receipts", "students", "adjustments", "extensions", "reminders",
        "import_batches", "audit", "counters",
        # Bus + historical-fee collections added after the initial backup list was written -
        # enumerating live collections below is the real fix, this list is just a floor so a
        # brand-new empty database still produces a complete-looking manifest.
        "bus_assignments", "bus_charges", "bus_charging_state", "fee_details", "student_opening_balances",
    ]
    try:
        live_colls = await db.list_collection_names()
    except Exception:
        live_colls = []
    all_colls = sorted(set(known_colls) | set(live_colls))
    manifest = {"id": bid, "kind": kind, "created_at": now_iso(), "created_by": actor_name, "app_version":"1.0.0", "database_version":"1", "collections": []}
    hasher = hashlib.sha256()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for coll in sorted(all_colls):
            rows = await db[coll].find({}, {"_id":0}).to_list(200000)
            payload = _json.dumps(rows, default=str)
            zf.writestr(f"{coll}.json", payload)
            manifest["collections"].append({"name": coll, "count": len(rows), "bytes": len(payload)})
            hasher.update(payload.encode())
        zf.writestr("manifest.json", _json.dumps(manifest, indent=2, default=str))
    with zipfile.ZipFile(path, "r") as zf:
        bad = zf.testzip()
        if bad: raise RuntimeError(f"Backup verification failed at {bad}")
    size = path.stat().st_size
    manifest["size"] = size
    manifest["filename"] = fname
    manifest["path"] = str(path)
    manifest["checksum_sha256"] = hasher.hexdigest()
    await db.backups.insert_one(manifest.copy())
    # Auto-rotation: keep the most-recent BACKUP_RETENTION zips, drop the older ones.
    rotated = await _rotate_backups()
    if rotated:
        manifest["rotated_out"] = rotated
    return manifest

async def _rotate_backups() -> List[str]:
    """Delete every backup zip beyond the most-recent BACKUP_RETENTION, both on disk and in `backups` collection.
    Returns the list of filenames that were dropped so callers can log them."""
    all_backups = await db.backups.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    if len(all_backups) <= BACKUP_RETENTION:
        return []
    to_drop = all_backups[BACKUP_RETENTION:]
    dropped: List[str] = []
    for b in to_drop:
        p = Path(b.get("path", "") or "")
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass  # missing file is fine; we still drop the DB row
        await db.backups.delete_one({"id": b["id"]})
        dropped.append(b.get("filename", b.get("id", "")))
    return dropped

# ---------------- Startup seed ----------------
async def seed_data():
    await db.users.create_index("email", unique=True)
    await db.students.create_index("admission_no", unique=True)
    await db.receipts.create_index("number", unique=True)
    await db.counters.create_index("key", unique=True)
    await db.fee_adjustment_applications.create_index("application_no", unique=True)
    # Idempotent offline sync: a unique index on local_id is the hard, DB-level
    # guarantee that retrying the same queued operation (e.g. after a dropped
    # connection mid-sync) can never apply twice - a duplicate insert attempt
    # fails outright rather than silently creating a second receipt.
    await db.sync_operations.create_index("local_id", unique=True)
    await db.devices.create_index("id", unique=True)

    # Receipt deletion PIN - seeded ONCE, on first setup only (same "never touch
    # it again here" rule as the admin account below, for the same reason: a
    # future change to this PIN must never be silently reverted by a restart).
    if not await db.security_config.find_one({"id": RECEIPT_DELETE_PIN_DOC_ID}):
        await db.security_config.insert_one({
            "id": RECEIPT_DELETE_PIN_DOC_ID, "pin_hash": hash_password("1618"),
            "created_at": now_iso(),
        })

    # Seed the admin account from .env on FIRST setup only. Once the account exists, its
    # password belongs to whoever is running the school - never touch it again here, or
    # every service restart would silently wipe out a real password change (the bug that
    # locked the admin out of their own software on 2026-09-03).
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": gen_id(), "email": admin_email, "password_hash": hash_password(admin_pw),
            "name": os.environ.get("ADMIN_NAME","Administrator"), "role": "administrator",
            "active": True, "created_at": now_iso(),
        })

    demo_users = [
        ("cashier@balajiconvent.in","cashier123","Ravi Cashier","cashier"),
        ("accountant@balajiconvent.in","account123","Sunita Accountant","accountant"),
        ("manager@balajiconvent.in","manager123","Anil Manager","manager"),
    ]
    for old_em, new_em in [
        ("cashier@balaji.local","cashier@balajiconvent.in"),
        ("accountant@balaji.local","accountant@balajiconvent.in"),
        ("manager@balaji.local","manager@balajiconvent.in"),
    ]:
        legacy = await db.users.find_one({"email": old_em})
        if legacy:
            if await db.users.find_one({"email": new_em}):
                await db.users.delete_one({"email": old_em})
            else:
                await db.users.update_one({"email": old_em}, {"$set": {"email": new_em}})
    for em, pw, nm, rl in demo_users:
        if not await db.users.find_one({"email": em}):
            await db.users.insert_one({"id": gen_id(),"email": em,"password_hash": hash_password(pw),"name": nm,"role": rl,"active": True,"created_at": now_iso()})

    if await db.departments.count_documents({}) == 0:
        depts = [
            {"name":"English Primary","code":"EP","header_line1":"BALAJI CONVENT","header_line2":"ENGLISH PRIMARY SCHOOL"},
            {"name":"Marathi Primary","code":"MP","header_line1":"BALAJI CONVENT","header_line2":"MARATHI PRIMARY SCHOOL"},
            {"name":"Secondary","code":"SEC","header_line1":"BALAJI CONVENT SECONDARY SCHOOL","header_line2":"SELF FINANCING"},
            {"name":"Junior College","code":"JC","header_line1":"BALAJI CONVENT JR. COLLEGE","header_line2":"ARTS, COMMERCE, SCIENCE & BI-FOCAL"},
        ]
        for d in depts:
            await db.departments.insert_one({"id": gen_id(), **d, "academic_year":"2026-27", "created_at": now_iso()})
    else:
        header_defaults = {
            "EP": ("BALAJI CONVENT", "ENGLISH PRIMARY SCHOOL"),
            "MP": ("BALAJI CONVENT", "MARATHI PRIMARY SCHOOL"),
            "SEC": ("BALAJI CONVENT SECONDARY SCHOOL", "SELF FINANCING"),
            "JC": ("BALAJI CONVENT JR. COLLEGE", "ARTS, COMMERCE, SCIENCE & BI-FOCAL"),
        }
        for code, (h1, h2) in header_defaults.items():
            await db.departments.update_one(
                {"code": code, "$or": [{"header_line1": {"$exists": False}}, {"header_line1": None}, {"header_line1": ""}]},
                {"$set": {"header_line1": h1, "header_line2": h2}},
            )

    if await db.fee_heads.count_documents({}) == 0:
        heads = [
            ("Tuition Fee","TUIT","school"),
            ("Exam Fee","EXAM","school"),
            ("Activity Fee","ACT","school"),
            ("Library Fee","LIB","school"),
            ("Admission Fee","ADM","admission"),
            ("Registration Fee","REG","admission"),
            ("Bus Fee","BUS","bus"),
            ("Uniform","UNI","misc"),
            ("Books","BOOK","misc"),
            ("Donation","DON","general"),
        ]
        for nm, cd, cat in heads:
            await db.fee_heads.insert_one({"id": gen_id(),"name": nm,"code": cd,"category": cat,"created_at": now_iso()})

    if await db.classes.count_documents({}) == 0:
        depts = await db.departments.find({}, {"_id":0}).to_list(100)
        by_code = {d["code"]: d for d in depts}
        specs = {
            "EP": ["Nursery","LKG","UKG","Class 1","Class 2","Class 3","Class 4","Class 5"],
            "MP": ["Class 1","Class 2","Class 3","Class 4","Class 5"],
            "SEC": ["Class 6","Class 7","Class 8","Class 9","Class 10"],
            "JC": ["Class 11 - Science","Class 11 - Commerce","Class 12 - Science","Class 12 - Commerce"],
        }
        for code, classes in specs.items():
            d = by_code.get(code)
            if not d: continue
            for nm in classes:
                await db.classes.insert_one({"id": gen_id(),"department_id": d["id"],"name": nm,"created_at": now_iso()})

# ---------------- Quarterly reminder generator ----------------
async def _generate_quarterly_reminders() -> Dict[str, int]:
    settings = await get_settings_doc()
    lead = int(settings.get("reminder_lead_days", 7) or 7)
    quarters = [
        ("Q1", settings.get("q1_due_date")),
        ("Q2", settings.get("q2_due_date")),
        ("Q3", settings.get("q3_due_date")),
    ]
    today = date.today()
    quarters = [(q, d) for q, d in quarters if d]
    if not quarters: return {"created": 0, "skipped": 0}

    students = await db.students.find({"status": "active", "fee_structure_id": {"$ne": None}}, {"_id": 0}).to_list(10000)
    if not students: return {"created": 0, "skipped": 0}
    fs_ids = list({s.get("fee_structure_id") for s in students if s.get("fee_structure_id")})
    fs_map = {f["id"]: f for f in await db.fee_structures.find({"id": {"$in": fs_ids}}, {"_id": 0}).to_list(500)}
    sids = [s["id"] for s in students]
    receipts = await db.receipts.find({"student_id": {"$in": sids}, "status": {"$ne": "cancelled"}, "receipt_type": {"$in": ["school", "admission"]}}, {"_id": 0}).to_list(20000)
    paid_q: Dict[str, set] = {}
    for r in receipts:
        for line in r.get("lines", []):
            nm = (line.get("fee_head_name") or "").lower()
            for tag in ("q1", "q2", "q3"):
                if tag in nm:
                    paid_q.setdefault(r["student_id"], set()).add(tag.upper())
    created, skipped = 0, 0
    for s in students:
        fs = fs_map.get(s["fee_structure_id"])
        if not fs: continue
        for q_label, q_due in quarters:
            try:
                due = datetime.strptime(q_due, "%Y-%m-%d").date()
            except Exception:
                continue
            days_to = (due - today).days
            if days_to > lead: continue
            if days_to < -60: continue
            if q_label in paid_q.get(s["id"], set()): continue
            amt = 0
            for it in fs.get("items", []):
                nm = (it.get("fee_head_name") or "").lower()
                if q_label.lower() in nm: amt += float(it.get("amount", 0))
            if amt <= 0: continue
            key = f"tuition-{q_label}-{q_due}"
            exists = await db.reminders.find_one({"student_id": s["id"], "key": key})
            if exists:
                skipped += 1; continue
            await db.reminders.insert_one({
                "id": gen_id(), "key": key, "student_id": s["id"],
                "installment_name": f"Tuition {q_label}", "amount": amt,
                "due_date": q_due, "status": "pending",
                "auto_generated": True, "created_at": now_iso(),
            })
            created += 1
    return {"created": created, "skipped": skipped}
