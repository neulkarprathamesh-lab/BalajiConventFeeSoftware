"""Student record version. Incremented on every real profile change so a future offline
client can detect that the server copy changed after it was cached (conflict detection).
Records created before this field existed are treated as version 1."""

BASE_VERSION = 1


def current_version(student: dict) -> int:
    v = student.get("version")
    return int(v) if isinstance(v, int) and v >= BASE_VERSION else BASE_VERSION


def next_version(student: dict) -> int:
    return current_version(student) + 1


def versions_to_backfill(students: list) -> list:
    """IDs of students that have no version yet. Only these are touched by the migration."""
    return [s["id"] for s in students if not isinstance(s.get("version"), int)]
