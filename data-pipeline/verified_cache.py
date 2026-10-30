"""Local cache for the website's history requests (nav_api.py, benchmark_api.py) — verified, never stale.

Every stored history file is listed in its bucket's manifest with a SHA-256. A file is kept on this PC under that
hash, so a cached copy is used only while the manifest still lists exactly that content; an update writes a new hash
and the new file is downloaded. Downloads that do not match the manifest are rejected (None), never cached.
The manifest itself is reused for MANIFEST_TTL seconds (the data changes twice a day).

    cached_manifest(client, path, bucket) → dict | None      (any JSON file; reused for MANIFEST_TTL seconds)
    verified_bytes(client, path, sha, bucket) → bytes | None
Cache folder: %LOCALAPPDATA%/Prosperr/cache/<bucket>/ (public fund / index prices only; no keys, no client data).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

MANIFEST_TTL = 300              # seconds
PRUNE_AFTER_DAYS = 7            # cached files not read for this long are removed
_HEX = set("0123456789abcdef")


def cache_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".cache")
    return Path(base) / "Prosperr" / "cache"


def _folder(bucket: str) -> Path:
    folder = cache_root() / "".join(ch for ch in bucket if ch.isalnum() or ch in "-_")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _write_atomic(target: Path, data: bytes) -> None:
    tmp = target.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, target)


def cached_manifest(client, path: str, bucket: str, ttl: int = MANIFEST_TTL) -> dict | None:
    """A JSON file of the bucket (its manifest, the peer statistics, the fund metadata), from the local copy when it is
    younger than ttl seconds."""
    local = _folder(bucket) / ("".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in path) or "file.json")
    try:
        if time.time() - local.stat().st_mtime < ttl:
            return json.loads(local.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    manifest = client.download_json(path)
    if manifest is not None:
        _write_atomic(local, json.dumps(manifest).encode("utf-8"))
    return manifest


def verified_bytes(client, path: str, sha: str | None, bucket: str) -> bytes | None:
    """The file's bytes when they match `sha` (from the local cache, else downloaded and checked); None otherwise."""
    if not sha or len(sha) != 64 or not set(sha) <= _HEX:
        return None
    local = _folder(bucket) / f"{sha}.parquet"
    try:
        data = local.read_bytes()
        if hashlib.sha256(data).hexdigest() == sha:
            os.utime(local)          # recently used: kept by prune()
            return data
    except OSError:
        pass
    data = client.download(path)
    if data is None or hashlib.sha256(data).hexdigest() != sha:
        return None
    _write_atomic(local, data)
    return data


def prune(bucket: str, older_than_days: int = PRUNE_AFTER_DAYS) -> int:
    """Removes cached files not read for older_than_days; returns how many."""
    cutoff = time.time() - older_than_days * 86400
    removed = 0
    for file in _folder(bucket).glob("*.parquet"):
        try:
            if file.stat().st_mtime < cutoff:
                file.unlink()
                removed += 1
        except OSError:
            pass
    return removed
