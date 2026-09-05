#!/usr/bin/env python3
"""Developer utility — build a signed .bcupdate archive for offline distribution.

Usage:
    python scripts/build_bcupdate.py \
        --version 1.1.0 \
        --min-supported 1.0.0 \
        --release-notes "Fixed defaulters export; added SMS templates" \
        --payload path/to/payload_dir \
        --out dist/BalajiConventFeeSoftware_v1.1.0.bcupdate \
        --private-key backend/keys/update_private.pem
        [--migration path/to/001_migration.py]
        [--restart-backend / --no-restart-backend]  (default: on)
        [--restart-frontend / --no-restart-frontend] (default: on)

`payload_dir` should mirror /app/, e.g.:
    payload_dir/frontend/build/…
    payload_dir/backend/routers/reports.py
    payload_dir/backend/requirements.txt
    payload_dir/version.json

The script computes SHA-256 for every file, writes manifest.json, RSA-signs it
(PSS + SHA-256), and packages everything into a single .bcupdate ZIP that can
be uploaded via Administration → Software Updates.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
except ImportError:
    print("ERROR: install `cryptography` — pip install cryptography", file=sys.stderr)
    sys.exit(2)


ALLOWED_ROOTS = (
    "frontend/build",
    "backend/core.py",
    "backend/server.py",
    "backend/routers",
    "backend/requirements.txt",
    "frontend/package.json",
    "static",
    "templates",
    "defaults.json",
    "version.json",
)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def collect(payload: Path) -> Dict[str, str]:
    files: Dict[str, str] = {}
    for p in payload.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(payload).as_posix()
        if not any(rel == r or rel.startswith(r + "/") for r in ALLOWED_ROOTS):
            print(f"  skip  {rel}  (outside allowed roots)", file=sys.stderr)
            continue
        files[rel] = sha256(p)
        print(f"  add   {rel}  {files[rel][:12]}…")
    if not files:
        print("ERROR: no allowed files found under payload dir.", file=sys.stderr)
        sys.exit(2)
    return files


def sign(manifest_bytes: bytes, private_key_path: Path) -> str:
    key = serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
    sig = key.sign(
        manifest_bytes,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode()


def build_zip(out: Path, manifest_bytes: bytes, signature_b64: str,
              payload: Path, files: Dict[str, str], migrations: List[Path]) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr("manifest.sig", signature_b64)
        for rel in files.keys():
            zf.write(payload / rel, arcname=f"payload/{rel}")
        for mig in migrations:
            zf.write(mig, arcname=f"migrations/{mig.name}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a signed .bcupdate archive.")
    ap.add_argument("--version", required=True)
    ap.add_argument("--min-supported", required=True)
    ap.add_argument("--release-notes", required=True)
    ap.add_argument("--payload", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--private-key", required=True, type=Path)
    ap.add_argument("--migration", action="append", default=[], type=Path,
                    help="Repeatable — path to a migration .py that exposes async def run(db).")
    ap.add_argument("--restart-backend", dest="restart_backend", action="store_true", default=True)
    ap.add_argument("--no-restart-backend", dest="restart_backend", action="store_false")
    ap.add_argument("--restart-frontend", dest="restart_frontend", action="store_true", default=True)
    ap.add_argument("--no-restart-frontend", dest="restart_frontend", action="store_false")
    ap.add_argument("--database-version", default=None)
    args = ap.parse_args()

    if not args.payload.is_dir():
        print(f"ERROR: payload dir not found: {args.payload}", file=sys.stderr); return 2
    if not args.private_key.exists():
        print(f"ERROR: private key not found: {args.private_key}", file=sys.stderr); return 2

    print(f"Building .bcupdate v{args.version} (min v{args.min_supported}) from {args.payload}")
    files = collect(args.payload)

    manifest = {
        "version": args.version,
        "min_supported_version": args.min_supported,
        "release_notes": args.release_notes,
        "build_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "database_version": args.database_version,
        "files": files,
        "migrations": [m.name for m in args.migration],
        "requires_backend_restart": bool(args.restart_backend),
        "requires_frontend_reload": bool(args.restart_frontend),
    }
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode()
    signature_b64 = sign(manifest_bytes, args.private_key)
    build_zip(args.out, manifest_bytes, signature_b64, args.payload, files, args.migration)

    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"\nDone → {args.out}  ({size_mb:.2f} MB, {len(files)} files, {len(args.migration)} migration(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
