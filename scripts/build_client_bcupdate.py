#!/usr/bin/env python3
"""Developer utility — build a signed CLIENT .bcupdate archive.

Unlike scripts/build_bcupdate.py (which patches the Main Server's own
backend/frontend), this packages exactly one file - the Electron Client's
resources/app.asar - for distribution to Client PCs via the Main Server's
/api/client-updates/* endpoints. Signed with the dedicated client-update
keypair (backend/keys/client_update_private.pem), never the server's.

Entries are written with ZIP_STORED (uncompressed) so the Client's
dependency-free Node ZIP reader (updater/zip-lite.js) never needs a DEFLATE
decompressor.

Usage:
    python scripts/build_client_bcupdate.py \
        --version 1.0.1 \
        --min-supported 1.0.0 \
        --release-notes "Fixed offline sync banner wording" \
        --app-asar path/to/app.asar \
        --out dist/BalajiFeeHub-Client-v1.0.1.bcupdate \
        --private-key backend/keys/client_update_private.pem
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

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
except ImportError:
    print("ERROR: install `cryptography` — pip install cryptography", file=sys.stderr)
    sys.exit(2)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sign(manifest_bytes: bytes, private_key_path: Path) -> str:
    key = serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
    sig = key.sign(
        manifest_bytes,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode()


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a signed CLIENT .bcupdate archive.")
    ap.add_argument("--version", required=True)
    ap.add_argument("--min-supported", required=True)
    ap.add_argument("--release-notes", required=True)
    ap.add_argument("--app-asar", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--private-key", required=True, type=Path)
    args = ap.parse_args()

    if not args.app_asar.is_file():
        print(f"ERROR: app.asar not found: {args.app_asar}", file=sys.stderr); return 2
    if not args.private_key.exists():
        print(f"ERROR: private key not found: {args.private_key}", file=sys.stderr); return 2

    asar_sha = sha256(args.app_asar)
    print(f"app.asar: {args.app_asar}  ({args.app_asar.stat().st_size:,} bytes, sha256 {asar_sha[:16]}…)")

    manifest = {
        "version": args.version,
        "min_supported_version": args.min_supported,
        "release_notes": args.release_notes,
        "build_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "package_type": "client",
        "files": {"resources/app.asar": asar_sha},
    }
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode()
    signature_b64 = sign(manifest_bytes, args.private_key)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr("manifest.sig", signature_b64)
        zf.write(args.app_asar, arcname="payload/resources/app.asar")

    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"\nDone -> {args.out}  ({size_mb:.2f} MB, version {args.version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
