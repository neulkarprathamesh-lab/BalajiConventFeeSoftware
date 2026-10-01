"""Temporary class-level Fee Edit Access — lets a Cashier request a narrow,
time-boxed exception to edit fees for one class/medium + scope (school/bus/
both), without ever being given the Master PIN. An Administrator/Manager
reviews the request and approves it with the Master PIN (the SAME PIN used
for receipt deletion - never a second PIN to configure), which grants a
temporary permission tied to PC + User + Class/Group + Scope + Expiry.

This module never touches the fee-edit business logic itself (still in
fee_details.py::update_student_fee) - it only answers "is THIS user, on
THIS device, allowed to edit fees for THIS student's class/scope right now"
via find_active_grant(), imported from there.

No websocket/push infrastructure exists in this codebase (see sync.py) -
"Admin receives a visible notification" is implemented the same way the
existing Payment Extension approval queue works: a pending-requests list the
Admin UI polls, not a live push.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from core import (
    db, audit, gen_id, get_current_user, now_iso, require_roles,
    require_fee_edit_access_pin, FeeEditAccessRequestIn, FeeEditAccessApproveIn,
)
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/api", tags=["fee-edit-access"])

REQUEST_ROLES = ("administrator", "manager", "accountant", "cashier")
MAX_DURATION_MINUTES = 240  # generous upper bound - Admin still picks the actual value, default 30


def _parse_iso(s: Optional[str]):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def find_active_grant(user: dict, device_id: str, student: dict, required_scope: str):
    """Returns the matching active grant doc, or None. A grant is active if:
    status == 'approved', not expired, not revoked, belongs to this exact
    user AND device, covers this student's class (and medium, if the grant
    was scoped to one), and covers the requested fee scope (school/bus) -
    'both' always matches. Never matches unrelated classes/scopes/users/PCs,
    by construction of this query."""
    if not device_id:
        return None
    now = datetime.now(timezone.utc)
    candidates = await db.fee_edit_access_requests.find({
        "status": "approved",
        "requested_by_id": user["id"],
        "device_id": device_id,
        "class_id": student.get("class_id"),
    }, {"_id": 0}).to_list(20)
    for g in candidates:
        exp = _parse_iso(g.get("expires_at"))
        if not exp or exp <= now:
            continue
        if g.get("scope") not in ("both", required_scope):
            continue
        if g.get("medium") and student.get("medium") != g.get("medium"):
            continue
        return g
    return None


@router.post("/fee-edit-access/requests")
async def create_request(body: FeeEditAccessRequestIn, user=Depends(require_roles(*REQUEST_ROLES))):
    if not body.reason.strip():
        raise HTTPException(400, "A reason is required")
    class_doc = await db.classes.find_one({"id": body.class_id}, {"_id": 0})
    if not class_doc:
        raise HTTPException(404, "Class not found")
    rid = gen_id()
    now = now_iso()
    doc = {
        "id": rid, "requested_by_id": user["id"], "requested_by_name": user["name"], "requested_by_role": user["role"],
        "device_id": body.device_id, "class_id": body.class_id, "class_name": class_doc.get("name") or body.class_name,
        "medium": body.medium or None, "scope": body.scope, "reason": body.reason.strip(),
        "status": "pending", "created_at": now,
        "approved_by_id": None, "approved_by_name": None, "approved_at": None, "expires_at": None, "duration_minutes": None,
        "revoked_at": None, "revoked_by_id": None, "revoked_by_name": None,
    }
    await db.fee_edit_access_requests.insert_one(doc)
    await audit(user, "fee_edit_access_requested", "fee_edit_access", rid, {
        "class_name": doc["class_name"], "medium": doc["medium"], "scope": doc["scope"],
        "reason": doc["reason"], "device_id": doc["device_id"],
    })
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/fee-edit-access/requests")
async def list_requests(status: Optional[str] = "pending", user=Depends(require_roles("administrator", "manager"))):
    q = {"status": status} if status and status != "all" else {}
    rows = await db.fee_edit_access_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@router.get("/fee-edit-access/my-active")
async def my_active(device_id: str, user=Depends(get_current_user)):
    """Polled by the Cashier's own Live Fee Update screen to show 'you have
    edit access to Class X until HH:MM' and to know which class/scope to
    unlock in the UI. Only ever returns THIS user's own active grants."""
    now = datetime.now(timezone.utc)
    rows = await db.fee_edit_access_requests.find({
        "status": "approved", "requested_by_id": user["id"], "device_id": device_id,
    }, {"_id": 0}).to_list(20)
    active = []
    for g in rows:
        exp = _parse_iso(g.get("expires_at"))
        if exp and exp > now:
            active.append(g)
    return active


@router.post("/fee-edit-access/requests/{req_id}/approve")
async def approve_request(req_id: str, body: FeeEditAccessApproveIn, user=Depends(require_fee_edit_access_pin)):
    req = await db.fee_edit_access_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, f"Request is already {req.get('status')}")
    duration = max(1, min(MAX_DURATION_MINUTES, int(body.duration_minutes or 30)))
    now_dt = datetime.now(timezone.utc)
    expires_at = (now_dt + timedelta(minutes=duration)).isoformat()
    await db.fee_edit_access_requests.update_one({"id": req_id}, {"$set": {
        "status": "approved", "approved_by_id": user["id"], "approved_by_name": user["name"],
        "approved_at": now_iso(), "expires_at": expires_at, "duration_minutes": duration,
    }})
    await audit(user, "fee_edit_access_approved", "fee_edit_access", req_id, {
        "requested_by_name": req.get("requested_by_name"), "class_name": req.get("class_name"),
        "medium": req.get("medium"), "scope": req.get("scope"), "device_id": req.get("device_id"),
        "duration_minutes": duration, "expires_at": expires_at,
    })
    return {"ok": True, "expires_at": expires_at, "duration_minutes": duration}


@router.post("/fee-edit-access/requests/{req_id}/reject")
async def reject_request(req_id: str, user=Depends(require_roles("administrator", "manager"))):
    req = await db.fee_edit_access_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, f"Request is already {req.get('status')}")
    await db.fee_edit_access_requests.update_one({"id": req_id}, {"$set": {"status": "rejected"}})
    await audit(user, "fee_edit_access_rejected", "fee_edit_access", req_id, {
        "requested_by_name": req.get("requested_by_name"), "class_name": req.get("class_name"),
    })
    return {"ok": True}


@router.post("/fee-edit-access/requests/{req_id}/revoke")
async def revoke_request(req_id: str, user=Depends(require_roles("administrator", "manager"))):
    """Immediately terminates an approved-but-not-yet-expired grant. Safe to
    call on an already-expired/revoked one too (idempotent no-op beyond the
    audit record)."""
    req = await db.fee_edit_access_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "approved":
        raise HTTPException(400, f"Request is not an active approval (status: {req.get('status')})")
    await db.fee_edit_access_requests.update_one({"id": req_id}, {"$set": {
        "status": "revoked", "revoked_at": now_iso(), "revoked_by_id": user["id"], "revoked_by_name": user["name"],
    }})
    await audit(user, "fee_edit_access_revoked", "fee_edit_access", req_id, {
        "requested_by_name": req.get("requested_by_name"), "class_name": req.get("class_name"),
        "device_id": req.get("device_id"),
    })
    return {"ok": True}
