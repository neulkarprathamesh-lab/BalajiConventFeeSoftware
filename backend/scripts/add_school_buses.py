"""Register the school's buses in the Bus Master (bus_routes), without duplicates.

Dry run by default:    python scripts/add_school_buses.py
Apply the inserts:     python scripts/add_school_buses.py --apply

For each supplied bus the existing Bus Master is searched by normalized registration first.
A bus that already exists is reused (never re-inserted). Nothing else in the database is changed.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def _load_env_file():
    import os
    env_path = Path(os.environ.get("FEEHUB_ENV_FILE", str(BACKEND / ".env")))
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

from bus_registry import SCHOOL_BUSES, find_existing_bus, full_registration  # noqa: E402


async def main(apply: bool):
    from core import db

    existing = await db.bus_routes.find({}, {"_id": 0}).to_list(500)
    print(f"Bus Master before: {len(existing)} record(s)")

    added, reused, conflicts = [], [], []
    for short in SCHOOL_BUSES:
        match = find_existing_bus(existing, short)
        if match:
            reused.append((short, match.get("id"), match.get("vehicle_no")))
            continue
        code_clash = next((r for r in existing if r.get("code") == short), None)
        if code_clash:
            conflicts.append((short, code_clash.get("id")))
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "name": short,
            "code": short,
            "vehicle_no": full_registration(short),
            "driver_name": None,
            "driver_mobile": None,
            "monthly_fee": 0,
            "stops": [],
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        added.append(doc)
        existing.append(doc)  # so later entries in this run are checked too

    print(f"Already present (reused): {len(reused)}")
    for short, rid, vno in reused:
        print(f"  reuse  {short:8} -> {vno} (id {rid})")
    print(f"To add: {len(added)}")
    for d in added:
        print(f"  add    {d['name']:8} -> {d['vehicle_no']}")
    if conflicts:
        print("CONFLICTS (not inserted, review manually):")
        for short, rid in conflicts:
            print(f"  {short} clashes with existing code on record {rid}")

    if not apply:
        print("Dry run only - nothing written. Re-run with --apply to insert.")
        return

    if added:
        await db.bus_routes.insert_many([dict(d) for d in added])
    print(f"Bus Master after: {await db.bus_routes.count_documents({})} record(s); inserted {len(added)}.")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
