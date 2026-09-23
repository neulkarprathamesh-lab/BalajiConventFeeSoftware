"""Offline-first Client sync: device registry (Connected PCs) + idempotent
push/pull for Client PCs that continue essential cashier work during a
temporary Main Server outage.

Design decisions (read before touching anything here):

- Receipt numbers are NEVER assigned client-side. The existing atomic
  `db.counters` sequence (next_receipt_number) is untouched and remains the
  ONLY source of a real receipt number - a queued offline receipt gets its
  real number only at the moment /sync/push actually applies it, by calling
  the SAME create_receipt() the online path uses. This is what makes two
  Client PCs being offline simultaneously safe: neither one ever invents a
  number, so there is nothing to collide.
- Idempotency is enforced at the DB level: `sync_operations.local_id` has a
  unique index (see core.py seed_data). A retried push for a local_id that
  already applied hits a duplicate-key error, which is caught and treated as
  "already done" - the cached result is replayed, nothing is created twice.
- Heartbeats update `devices.last_seen` only - they are deliberately NOT
  written to audit_log (the task this was built for explicitly warns against
  flooding the audit log with heartbeats). Only real events are audited:
  client_registered (first heartbeat ever for a device_id), pc_name_assigned,
  sync_completed, offline_transaction_synced.
- Pull is a full snapshot of the small master-data tables a cashier needs
  offline (students, fee_structures, departments, classes, settings) - not
  incremental. The existing data model has no updated_at/version tracking on
  these collections, and retrofitting that safely is a larger, separate
  change; a full snapshot of ~2000 students is a few hundred KB, well within
  what a school LAN sync can do in well under a second. Left as a documented
  future optimization rather than risking a wider, riskier data-model change
  here.
"""
from typing import Any, Dict, List, Optional
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, HTTPException, Depends, Request
from core import (
    db, audit, gen_id, get_current_user, now_iso, require_roles,
    DeviceHeartbeatIn, DeviceRenameIn, SyncPushIn, ReceiptIn,
    compute_fee_items, apply_opening_paid, eligible_receipt_codes_for_class,
)

router = APIRouter(prefix="/api", tags=["sync"])

ONLINE_WINDOW_SECONDS = 90  # a device not heard from in this long counts as Offline


def _device_status(last_seen: Optional[str]) -> str:
    if not last_seen:
        return "offline"
    try:
        from datetime import datetime, timezone
        seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=timezone.utc)
        delta = (datetime.now(timezone.utc) - seen).total_seconds()
        return "online" if delta <= ONLINE_WINDOW_SECONDS else "offline"
    except Exception:
        return "offline"


# ---------------- Device registry (Connected PCs) ----------------

@router.post("/devices/heartbeat")
async def device_heartbeat(body: DeviceHeartbeatIn, request: Request, user=Depends(get_current_user)):
    existing = await db.devices.find_one({"id": body.device_id}, {"_id": 0})
    now = now_iso()
    # Always taken fresh from the request itself (never client-reported) so a
    # PC that reconnects with a different LAN IP (DHCP lease change, different
    # NIC, etc.) is reflected automatically on the very next heartbeat.
    ip_address = request.client.host if request.client else None
    if not existing:
        doc = {
            "id": body.device_id, "friendly_name": None,
            "first_seen": now, "last_seen": now, "last_sync_at": None,
            "app_version": body.app_version, "pending_count": body.pending_count,
            "ip_address": ip_address,
            "current_user_id": user["id"], "current_user_name": user["name"],
            "created_at": now,
        }
        await db.devices.insert_one(doc)
        await audit(user, "client_registered", "device", body.device_id, {"app_version": body.app_version, "ip_address": ip_address})
    else:
        await db.devices.update_one({"id": body.device_id}, {"$set": {
            "last_seen": now, "app_version": body.app_version or existing.get("app_version"),
            "pending_count": body.pending_count, "ip_address": ip_address,
            "current_user_id": user["id"], "current_user_name": user["name"],
        }})
    return {"device_id": body.device_id, "friendly_name": (existing or {}).get("friendly_name")}


@router.get("/devices")
async def list_devices(online_only: bool = False, user=Depends(require_roles("administrator", "manager"))):
    rows = await db.devices.find({}, {"_id": 0}).sort("last_seen", -1).to_list(500)
    for d in rows:
        d["status"] = _device_status(d.get("last_seen"))
    if online_only:
        rows = [d for d in rows if d["status"] == "online"]
    return rows


@router.get("/devices/{device_id}")
async def get_device(device_id: str, user=Depends(require_roles("administrator", "manager"))):
    d = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Device not found")
    d["status"] = _device_status(d.get("last_seen"))
    return d


@router.get("/sync/failed-operations")
async def failed_sync_operations(user=Depends(require_roles("administrator", "manager"))):
    """Surfaces offline operations still stuck failing after a retry, so an
    admin can actually discover a receipt/expense/bill that never made it to
    the Main Server instead of only seeing an opaque 'Pending' count on
    Connected PCs. Read-only - never touches sync_operations itself."""
    rows = await db.sync_operations.find({"status": "failed"}, {"_id": 0}).sort("applied_at", -1).to_list(200)
    device_names = {d["id"]: d.get("friendly_name") for d in await db.devices.find({}, {"_id": 0, "id": 1, "friendly_name": 1}).to_list(500)}
    for r in rows:
        r["device_name"] = device_names.get(r.get("device_id")) or r.get("device_id")
    return rows


@router.patch("/devices/{device_id}")
async def rename_device(device_id: str, body: DeviceRenameIn, user=Depends(require_roles("administrator"))):
    d = await db.devices.find_one({"id": device_id})
    if not d:
        raise HTTPException(404, "Device not found")
    name = body.friendly_name.strip()
    if not name:
        raise HTTPException(400, "A name is required")
    await db.devices.update_one({"id": device_id}, {"$set": {"friendly_name": name}})
    await audit(user, "pc_name_assigned", "device", device_id, {"friendly_name": name, "previous_name": d.get("friendly_name")})
    return {"ok": True, "friendly_name": name}


# ---------------- Sync: pull (server -> client master data) ----------------

@router.get("/sync/pull")
async def sync_pull(device_id: str, user=Depends(get_current_user)):
    """Everything a Client needs to keep working offline: enough student +
    fee-structure + master data to search a student, show their live fee
    position, and issue a receipt against the correct department/fee rules.
    Read-only; never creates or changes anything.

    Each student is enriched with the SAME per-head fee_items/eligible-receipt-type
    computation the live ledger/eligible-receipt-types endpoints use (compute_fee_items,
    apply_opening_paid, eligible_receipt_codes_for_class — imported from core.py, never
    a second copy of this logic) so a Client PC can show an accurate "as of last sync"
    balance and receipt-type suggestion while genuinely offline, not just a raw student
    record with no fee position. All heavy collections are fetched once and grouped
    in-memory below rather than queried per-student, to keep this cheap even though it
    runs on every periodic sync."""
    students = await db.students.find({"status": "active"}, {
        "_id": 0, "id": 1, "name": 1, "admission_no": 1, "class_id": 1, "section": 1,
        "medium": 1, "stream": 1, "department_id": 1, "fee_structure_id": 1,
        "bus_required": 1, "bus_stop_no": 1, "guardian_name": 1, "guardian_mobile": 1,
        "academic_year": 1,
    }).to_list(10000)
    fee_structures = await db.fee_structures.find({}, {"_id": 0}).to_list(2000)
    departments = await db.departments.find({}, {"_id": 0}).to_list(50)
    classes = await db.classes.find({}, {"_id": 0}).to_list(2000)
    receipt_types = await db.receipt_types.find({"enabled": True}, {"_id": 0}).to_list(50)
    settings = await db.settings.find_one({}, {"_id": 0, "pin_hash": 0}) or {}

    fs_by_id = {f["id"]: f for f in fee_structures}
    classes_by_id = {c["id"]: c for c in classes}
    depts_by_id = {d["id"]: d for d in departments}

    def _bucket(rows, key):
        out: Dict[str, list] = {}
        for r in rows:
            out.setdefault(r.get(key), []).append(r)
        return out

    all_receipts = await db.receipts.find({"status": {"$ne": "cancelled"}}, {
        "_id": 0, "student_id": 1, "receipt_type": 1, "lines": 1,
    }).to_list(200000)
    receipts_by_sid = _bucket(all_receipts, "student_id")

    all_overrides = await db.student_fee_overrides.find({}, {"_id": 0}).to_list(50000)
    overrides_by_sid: Dict[str, list] = {}
    for ov in all_overrides:
        overrides_by_sid.setdefault(ov.get("student_id"), []).append(ov)

    all_fee_details = await db.fee_details.find({}, {"_id": 0, "student_id": 1, "academic_year": 1, "total_paid": 1}).to_list(50000)
    fee_details_by_sid = {(fd.get("student_id"), fd.get("academic_year")): fd for fd in all_fee_details}

    all_bus_charges = await db.bus_charges.find({}, {"_id": 0}).to_list(200000)
    bus_charges_by_sid = _bucket(all_bus_charges, "student_id")

    for s in students:
        sid = s["id"]
        ay = s.get("academic_year") or "2026-27"
        fs = fs_by_id.get(s.get("fee_structure_id"))
        receipts = receipts_by_sid.get(sid, [])
        overrides = [o for o in overrides_by_sid.get(sid, []) if o.get("academic_year") == ay]
        fee_detail_doc = fee_details_by_sid.get((sid, ay))
        opening_paid = float(fee_detail_doc.get("total_paid") or 0) if fee_detail_doc else 0

        fee_items = compute_fee_items((fs.get("items") if fs else None) or [], overrides, receipts)
        fee_items, opening_paid_unabsorbed = apply_opening_paid(fee_items, opening_paid)
        total_paid = sum(it["paid"] for it in fee_items) + opening_paid_unabsorbed
        school_outstanding = max(0, (fs.get("total") if fs else 0) - total_paid)

        bus_charges = sorted(bus_charges_by_sid.get(sid, []), key=lambda c: c.get("month") or "", reverse=True)
        bus_outstanding = sum(max(0, c.get("amount", 0) - c.get("amount_paid", 0)) for c in bus_charges if c.get("status") != "paid")

        class_doc = classes_by_id.get(s.get("class_id"))
        dept = depts_by_id.get(s.get("department_id"))
        dept_code = dept.get("code") if dept else None
        class_name = class_doc.get("name") if class_doc else None
        specific_codes, elig_notes = eligible_receipt_codes_for_class(class_name, s.get("medium"), s.get("stream"))
        eligible, matched = [], []
        for t in receipt_types:
            code = t.get("code")
            allowed = t.get("applicable_dept_codes") or []
            if dept_code and allowed and dept_code not in allowed:
                continue
            if code == "BUS":
                if s.get("bus_required"):
                    eligible.append({"id": t["id"], "code": code, "name": t["name"]})
                continue
            if code == "DV":
                continue
            if code == "EMJC":
                eligible.append({"id": t["id"], "code": code, "name": t["name"]})
                continue
            if code in specific_codes:
                eligible.append({"id": t["id"], "code": code, "name": t["name"]})
                matched.append(t)
        primary = None
        if matched:
            jc_match = next((t for t in matched if t.get("code") == "JC"), None)
            primary = (jc_match or matched[0])["id"]

        s["class_name"] = class_name
        s["fee_items"] = fee_items
        s["total_paid"] = round(total_paid, 2)
        s["school_outstanding"] = round(school_outstanding, 2)
        s["bus_charges"] = bus_charges
        s["bus_outstanding"] = round(bus_outstanding, 2)
        s["eligible_receipt_types"] = {
            "primary": primary, "eligible": eligible,
            "bus_eligible": bool(s.get("bus_required")), "notes": elig_notes,
        }

    synced_at = now_iso()
    await db.devices.update_one({"id": device_id}, {"$set": {"last_sync_at": synced_at}}, upsert=False)
    return {
        "synced_at": synced_at,
        "students": students, "fee_structures": fee_structures,
        "departments": departments, "classes": classes, "receipt_types": receipt_types,
        "settings": settings,
    }


# ---------------- Sync: push (client -> server offline transactions) ----------------

@router.post("/sync/push")
async def sync_push(body: SyncPushIn, user=Depends(get_current_user)):
    """Applies queued offline operations EXACTLY ONCE each, in order. Every
    operation is looked up by local_id in `sync_operations` first; if it was
    already applied (this push is a retry after a dropped connection, or the
    client called push twice), the ORIGINAL result is replayed and nothing
    is created again. Currently supports create_receipt only - the one
    genuinely money-moving offline action; other offline op types can be
    added the same way without touching this idempotency mechanism."""
    results = []
    applied_count = 0
    for op in body.operations:
        existing = await db.sync_operations.find_one({"local_id": op.local_id}, {"_id": 0})
        # Only a previously-APPLIED op is safe to just replay - re-running it
        # would create a genuine duplicate. A previously-FAILED op (e.g. a
        # transient error, or master data that has since caught up) must be
        # retried, never permanently stuck replaying its own old failure
        # forever - that was the actual root cause of "receipt entered on a
        # Client PC but never appears on the Main Server": the op kept
        # resyncing every 20s but the server just replayed the same stale
        # failure every time without ever attempting create_receipt again.
        if existing and existing["status"] == "applied":
            results.append({"local_id": op.local_id, "status": existing["status"], "result": existing.get("result"), "error": existing.get("error"), "replayed": True})
            continue
        # A cap on retries for one stubbornly-failing op, so a genuinely bad
        # payload (never going to succeed) doesn't hammer create_receipt()
        # every ~20s forever - past this it just keeps replaying its last
        # failure until an admin/cashier actually fixes/removes it client-side.
        if existing and (existing.get("retry_count") or 0) >= 20:
            results.append({"local_id": op.local_id, "status": existing["status"], "result": existing.get("result"), "error": existing.get("error"), "replayed": True, "retry_limit_reached": True})
            continue

        result, error, status = None, None, "failed"
        if op.op_type == "create_receipt":
            try:
                from routers.receipts import create_receipt
                receipt = await create_receipt(ReceiptIn(**op.payload), user)
                result = {"receipt_id": receipt["id"], "receipt_number": receipt["number"]}
                status = "applied"
            except HTTPException as e:
                error = e.detail
            except Exception as e:
                error = str(e)
        elif op.op_type == "create_expense":
            try:
                from routers.accounting import create_expense
                expense = await create_expense(op.payload, user)
                result = {"expense_id": expense["id"], "expense_no": expense["expense_no"]}
                status = "applied"
            except HTTPException as e:
                error = e.detail
            except Exception as e:
                error = str(e)
        elif op.op_type == "create_bill":
            try:
                from routers.accounting import create_bill
                bill = await create_bill(op.payload, user)
                result = {"bill_id": bill["id"], "bill_no": bill["bill_no"]}
                status = "applied"
            except HTTPException as e:
                error = e.detail
            except Exception as e:
                error = str(e)
        else:
            error = f"Unknown op_type '{op.op_type}'"

        record = {
            "id": (existing or {}).get("id") or gen_id(), "local_id": op.local_id, "device_id": body.device_id,
            "user_id": user["id"], "user_name": user["name"], "op_type": op.op_type,
            "status": status, "result": result, "error": error,
            "client_created_at": op.client_created_at, "applied_at": now_iso(),
            "retry_count": ((existing or {}).get("retry_count") or 0) + (1 if existing else 0),
        }
        try:
            if existing:
                # Retrying a previously-failed op - replace that same record
                # in place (same local_id, same unique-index slot) rather than
                # inserting a second row for it.
                await db.sync_operations.replace_one({"local_id": op.local_id}, record)
            else:
                await db.sync_operations.insert_one(record)
        except DuplicateKeyError:
            # Lost the race to another concurrent push of the same local_id -
            # the DB-level unique index is the real guarantee; replay whatever
            # the winner recorded instead of trusting our own in-flight result.
            existing = await db.sync_operations.find_one({"local_id": op.local_id}, {"_id": 0})
            results.append({"local_id": op.local_id, "status": existing["status"], "result": existing.get("result"), "error": existing.get("error"), "replayed": True})
            continue

        if status == "applied":
            applied_count += 1
            entity_by_type = {"create_receipt": "receipt", "create_expense": "expense", "create_bill": "bill"}
            id_key_by_type = {"create_receipt": "receipt_id", "create_expense": "expense_id", "create_bill": "bill_id"}
            number_key_by_type = {"create_receipt": "receipt_number", "create_expense": "expense_no", "create_bill": "bill_no"}
            entity_id = (result or {}).get(id_key_by_type.get(op.op_type, ""), "")
            await audit(user, "offline_transaction_synced", entity_by_type.get(op.op_type, op.op_type), entity_id, {
                "local_id": op.local_id, "device_id": body.device_id, "op_type": op.op_type,
                "number": (result or {}).get(number_key_by_type.get(op.op_type, ""), None),
                "client_created_at": op.client_created_at,
            })
        results.append({"local_id": op.local_id, "status": status, "result": result, "error": error, "replayed": False})

    synced_at = now_iso()
    await db.devices.update_one({"id": body.device_id}, {"$set": {"last_sync_at": synced_at}})
    if applied_count:
        await audit(user, "sync_completed", "device", body.device_id, {"applied": applied_count, "total": len(body.operations)})
    return {"synced_at": synced_at, "results": results}
