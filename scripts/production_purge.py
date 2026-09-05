#!/usr/bin/env python3
"""Offline production data purge — standalone CLI.

Usage (inside /app):
    python -m scripts.production_purge --confirm
    python -m scripts.production_purge --confirm --clear-backups --clear-staged
    python -m scripts.production_purge --preview       # counts only, no delete

Requires backend/.env with MONGO_URL + DB_NAME.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import shutil
import sys
from pathlib import Path

# Load env
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME   = os.environ["DB_NAME"]

TRANSACTIONAL = [
    "students", "receipts", "adjustments", "payment_extensions",
    "reminders", "notices", "audit_log", "config_snapshots",
    "updates", "backups", "diagnostics_snapshots",
]
MASTER = [
    "departments", "classes", "fee_heads", "fee_structures",
    "receipt_types", "bus_stops", "bus_routes", "users",
    "settings", "config_defaults",
]

STAGING_DIRS = [Path("/app/updates/staging"), Path("/app/updates/rollback")]
BACKUPS_DIR  = Path("/app/backups")


async def run(preview: bool, clear_backups: bool, clear_staged: bool):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"\n=== {'PREVIEW' if preview else 'PURGE'} · Balaji FeeHub production reset ===\n")

    print(">>> Would DELETE (transactional):")
    for c in TRANSACTIONAL:
        n = await db[c].count_documents({})
        print(f"    {c:30s}  {n:>8} row(s)")

    print("\n>>> Would PRESERVE (master):")
    for c in MASTER:
        n = await db[c].count_documents({})
        print(f"    {c:30s}  {n:>8} row(s)")

    counters_n = await db.counters.count_documents({})
    print(f"\n>>> Counters will be RESET: {counters_n} counter(s)")

    if preview:
        print("\n[PREVIEW] No changes made.")
        return

    print("\nApplying purge…")
    for c in TRANSACTIONAL:
        r = await db[c].delete_many({})
        print(f"    - {c:30s}  {r.deleted_count:>8} deleted")
    cr = await db.counters.delete_many({})
    print(f"    - counters                        {cr.deleted_count:>8} deleted (all numbering restarts from 1)")

    if clear_staged:
        for d in STAGING_DIRS:
            if d.exists():
                for child in d.iterdir():
                    if child.is_dir(): shutil.rmtree(child, ignore_errors=True)
                    else: child.unlink(missing_ok=True)
                print(f"    - cleared {d}")

    if clear_backups and BACKUPS_DIR.exists():
        removed = 0
        for f in BACKUPS_DIR.glob("*.zip"):
            f.unlink(); removed += 1
        print(f"    - removed {removed} backup ZIP file(s) from {BACKUPS_DIR}")

    print("\n[OK] Production purge complete — the database is now in fresh-install state.\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Production data purge.")
    ap.add_argument("--preview", action="store_true", help="Show counts only; do nothing.")
    ap.add_argument("--confirm", action="store_true", help="Required to actually delete.")
    ap.add_argument("--clear-backups", action="store_true", help="Also delete backup ZIPs on disk.")
    ap.add_argument("--clear-staged", action="store_true", help="Also clear /app/updates/{staging,rollback}.")
    args = ap.parse_args()
    if not args.preview and not args.confirm:
        print("Refusing to delete without --confirm. Use --preview to see what would be deleted.", file=sys.stderr)
        return 2
    asyncio.run(run(args.preview, args.clear_backups, args.clear_staged))
    return 0


if __name__ == "__main__":
    sys.exit(main())
