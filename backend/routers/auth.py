"""Auth, self-profile, PIN management, users CRUD, settings, admin-PIN verify, version."""
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Depends, Response, Request
from core import (
    db, ACCESS_MIN, LoginIn, ProfileUpdate, PinSetIn, PinVerifyIn, UserCreate,
    audit, clean, get_current_user, get_settings_doc, require_roles,
    hash_password, verify_password, create_access_token, now_iso, gen_id, SETTINGS_ID,
    APP_ROOT, is_server_local_request,
)

router = APIRouter(prefix="/api", tags=["auth"])

# ---------- Auth ----------
@router.post("/auth/login")
async def login(body: LoginIn, response: Response, request: Request):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(403, "Account disabled")
    if user["role"] == "administrator" and not is_server_local_request(request):
        await audit(clean(user), "login_blocked_remote", "auth", user["id"], {"client_ip": request.client.host if request.client else None})
        raise HTTPException(403, "Administrator accounts can only sign in from the Main Server itself, not over the network.")
    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=ACCESS_MIN*60, path="/")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    return {"token": token, "user": clean(user)}

@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@router.get("/auth/me")
async def me(user = Depends(get_current_user)):
    return user

@router.patch("/auth/me")
async def update_me(body: ProfileUpdate, user = Depends(get_current_user)):
    upd: Dict[str, Any] = {}
    if body.name and body.name.strip():
        upd["name"] = body.name.strip()
    if body.new_password:
        if not body.current_password:
            raise HTTPException(400, "Current password required to change password")
        current = await db.users.find_one({"id": user["id"]})
        if not current or not verify_password(body.current_password, current["password_hash"]):
            raise HTTPException(400, "Current password is incorrect")
        if len(body.new_password) < 6:
            raise HTTPException(400, "New password must be at least 6 characters")
        upd["password_hash"] = hash_password(body.new_password)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    await audit(user, "update", "profile", user["id"], {"fields": [k for k in upd.keys() if k != "password_hash"] + (["password"] if "password_hash" in upd else [])})
    fresh = await db.users.find_one({"id": user["id"]})
    return clean(fresh)

# ---------- PIN ----------
@router.get("/auth/me/pin-status")
async def pin_status(user = Depends(get_current_user)):
    current = await db.users.find_one({"id": user["id"]})
    return {"has_pin": bool(current and current.get("pin_hash"))}

@router.post("/auth/me/pin")
async def set_pin(body: PinSetIn, user = Depends(get_current_user)):
    if not body.new_pin.isdigit() or len(body.new_pin) != 4:
        raise HTTPException(400, "PIN must be exactly 4 digits")
    current = await db.users.find_one({"id": user["id"]})
    if current.get("pin_hash"):
        if not body.current_pin or not verify_password(body.current_pin, current["pin_hash"]):
            raise HTTPException(400, "Current PIN is incorrect")
    else:
        if not body.current_password or not verify_password(body.current_password, current["password_hash"]):
            raise HTTPException(400, "Current password is required to set PIN")
    await db.users.update_one({"id": user["id"]}, {"$set": {"pin_hash": hash_password(body.new_pin)}})
    await audit(user, "set_pin", "user", user["id"])
    return {"ok": True}

@router.delete("/auth/me/pin")
async def remove_pin(user = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$unset": {"pin_hash": ""}})
    await audit(user, "remove_pin", "user", user["id"])
    return {"ok": True}

@router.post("/auth/me/pin/verify")
async def verify_pin(body: PinVerifyIn, user = Depends(get_current_user)):
    current = await db.users.find_one({"id": user["id"]})
    if not current or not current.get("pin_hash"):
        raise HTTPException(400, "No PIN set")
    if not verify_password(body.pin, current["pin_hash"]):
        raise HTTPException(401, "Incorrect PIN")
    return {"ok": True}

@router.post("/auth/admin-pin/verify")
async def verify_admin_pin(body: Dict[str, Any], user = Depends(require_roles("administrator"))):
    pin = body.get("pin","")
    current = await db.users.find_one({"id": user["id"]})
    if not current.get("pin_hash"):
        raise HTTPException(400, "Administrator PIN not set. Please set it in My Profile.")
    ok = verify_password(pin, current["pin_hash"])
    await audit(user, "admin_pin_verify", "auth", user["id"], {"ok": ok})
    if not ok:
        raise HTTPException(403, "Invalid administrator PIN")
    return {"ok": True}

# ---------- Settings ----------
@router.get("/settings")
async def read_settings(user = Depends(get_current_user)):
    return await get_settings_doc()


# Option E: the approved physical receipt stock is fixed at exactly these
# dimensions, in landscape, per repeated explicit confirmation (ruler-measured
# by the school). This is deliberately NOT admin-editable to an arbitrary
# value — only the configured printer (receipt_printer_name) is meant to be
# changeable per Phase 12. If a future business decision genuinely changes the
# physical paper, update these two constants (and re-run the full Option E
# verification procedure against the new size) rather than letting an
# arbitrary PATCH silently drift the production paper size.
REQUIRED_RECEIPT_WIDTH_MM = 210.0
REQUIRED_RECEIPT_HEIGHT_MM = 142.8
REQUIRED_RECEIPT_ORIENTATION = "landscape"
_MM_TOLERANCE = 0.05

@router.patch("/settings")
async def update_settings(body: Dict[str, Any], user = Depends(require_roles("administrator"))):
    await get_settings_doc()
    allowed = {k: v for k, v in body.items() if k in ("school_name","school_address","school_phone","school_email","school_website","receipt_footer","notice_footer","bus_annual_months","q1_due_date","q2_due_date","q3_due_date","reminder_lead_days","manager_waiver_cap","receipt_printer_name","receipt_paper_source","receipt_paper_width_mm","receipt_paper_height_mm","receipt_orientation","receipt_media_size","receipt_media_width_mm","receipt_media_height_mm","receipt_printer_verified","receipt_printer_verified_at","receipt_printer_verified_by")}

    if "receipt_paper_width_mm" in allowed:
        try:
            w = float(allowed["receipt_paper_width_mm"])
        except (TypeError, ValueError):
            raise HTTPException(400, "receipt_paper_width_mm must be a number")
        if w <= 0:
            raise HTTPException(400, "receipt_paper_width_mm must be positive")
        if abs(w - REQUIRED_RECEIPT_WIDTH_MM) > _MM_TOLERANCE:
            raise HTTPException(400, f"receipt_paper_width_mm must be exactly {REQUIRED_RECEIPT_WIDTH_MM}mm (the approved physical receipt stock) — got {w}")

    if "receipt_paper_height_mm" in allowed:
        try:
            h = float(allowed["receipt_paper_height_mm"])
        except (TypeError, ValueError):
            raise HTTPException(400, "receipt_paper_height_mm must be a number")
        if h <= 0:
            raise HTTPException(400, "receipt_paper_height_mm must be positive")
        if abs(h - REQUIRED_RECEIPT_HEIGHT_MM) > _MM_TOLERANCE:
            raise HTTPException(400, f"receipt_paper_height_mm must be exactly {REQUIRED_RECEIPT_HEIGHT_MM}mm (the approved physical receipt stock) — got {h}")

    if "receipt_orientation" in allowed and allowed["receipt_orientation"] != REQUIRED_RECEIPT_ORIENTATION:
        raise HTTPException(400, f"receipt_orientation must be '{REQUIRED_RECEIPT_ORIENTATION}' — got '{allowed['receipt_orientation']}'")

    if "receipt_printer_name" in allowed:
        name = (allowed["receipt_printer_name"] or "").strip()
        if name in ("Microsoft Print to PDF", "OneNote (Desktop)", "OneNote"):
            raise HTTPException(400, f"'{name}' is not a physical receipt printer and cannot be configured as one")
        allowed["receipt_printer_name"] = name

    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": allowed})
    await audit(user, "update", "settings", SETTINGS_ID, allowed)
    return await get_settings_doc()

# ---------- Users (admin) ----------
@router.get("/users")
async def list_users(user = Depends(require_roles("administrator"))):
    return await db.users.find({}, {"password_hash":0, "_id":0}).to_list(500)

@router.post("/users")
async def create_user(body: UserCreate, user = Depends(require_roles("administrator"))):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(400, "Email already exists")
    uid = gen_id()
    doc = {
        "id": uid, "email": body.email.lower(), "password_hash": hash_password(body.password),
        "name": body.name, "role": body.role, "department_id": body.department_id,
        "active": True, "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await audit(user, "create", "user", uid, {"email": body.email, "role": body.role})
    return clean(doc)

@router.patch("/users/{uid}")
async def update_user(uid: str, body: Dict[str, Any], user = Depends(require_roles("administrator"))):
    upd = {k: v for k, v in body.items() if k in ("name","role","department_id","active")}
    if "password" in body and body["password"]:
        upd["password_hash"] = hash_password(body["password"])
    await db.users.update_one({"id": uid}, {"$set": upd})
    await audit(user, "update", "user", uid, upd)
    return {"ok": True}

# ---------- Version ----------
@router.get("/version")
async def app_version():
    """Live app version — reads /app/version.json each call so a .bcupdate install
    is reflected immediately without a code restart being required by callers."""
    import json as _json
    vf = APP_ROOT / "version.json"
    v = {}
    if vf.exists():
        try: v = _json.loads(vf.read_text())
        except Exception: v = {}
    return {
        "version": v.get("version", "1.0.0"),
        "app_version": v.get("version", "1.0.0"),
        "database_version": v.get("database_version", "1"),
        "receipt_template_version": v.get("receipt_template_version", "1.0"),
        "app_template_version": v.get("app_template_version", "1.0"),
        "build_date": v.get("build_date", "2026-02-04"),
        "developer": "Emergent Labs",
        "server_time": now_iso(),
    }
