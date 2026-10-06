"""Adds the additive `version` field to student records that do not have one yet.
Dry run by default; `--apply` writes. Touches only the `version` field, and only where it is absent."""
import asyncio
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def _load_env_file():
    env_path = Path(os.environ.get("FEEHUB_ENV_FILE", str(BACKEND / ".env")))
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()
from student_version import versions_to_backfill, BASE_VERSION  # noqa: E402


async def main(apply: bool):
    from core import db
    students = await db.students.find({}, {"_id": 0, "id": 1, "version": 1}).to_list(100000)
    todo = versions_to_backfill(students)
    print(f"students total: {len(students)} | without version: {len(todo)}")
    if not apply:
        print("Dry run only - nothing written. Re-run with --apply.")
        return
    if todo:
        res = await db.students.update_many({"id": {"$in": todo}, "version": {"$exists": False}},
                                            {"$set": {"version": BASE_VERSION}})
        print(f"set version={BASE_VERSION} on {res.modified_count} record(s)")
    print(f"students without version after: {await db.students.count_documents({'version': {'$exists': False}})}")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
