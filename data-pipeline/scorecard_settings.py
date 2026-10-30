"""Owner settings for the Fund Scorecard: pillar weights and the conditions a fund must meet to be rated.

Usage:
    python data-pipeline/scorecard_settings.py set-password     # you, once, in a terminal: asks for the edit password twice
                                                                # and stores only its salted hash in .env
  by serve.ps1:
    python data-pipeline/scorecard_settings.py get --can-edit=true|false   # stdout: { canEdit, passwordSet, settings }
    python data-pipeline/scorecard_settings.py verify   # stdin: { password } → { ok } | error
    python data-pipeline/scorecard_settings.py set      # stdin: { password, weights, conditions } → validated, saved, echoed
    python data-pipeline/scorecard_settings.py password # stdin: { password, confirm } → create the edit password, only when
                                                        # none is set (PASSWORD_FINAL: once set it cannot be changed here)
Editing needs both: a request from this PC (the server refuses others) and the edit password. The password itself is never
stored or logged — only PBKDF2-SHA256 (salted, PASSWORD_ITERATIONS rounds) in .env as SCORECARD_PASSWORD_HASH; a wrong
password costs a one-second wait. Saved to
config/scorecard-settings.json (outside every folder the server shares with other computers).
Defaults live in calculation-engine/config.js (SCORECARD); this file holds the owner's choice. The keys and ranges
below must match that config: an unknown key, a value out of range or weights not totalling 100 is refused.
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))   # settings.py (reads .env)

SETTINGS_FILE = Path(__file__).resolve().parents[1] / "config" / "scorecard-settings.json"
PILLARS = ("returns", "riskAdjusted", "benchmark", "volatility", "downside", "consistency", "quality")
CONDITIONS = {                       # name: (minimum, maximum)
    "minHistoryYears": (2, 10),      # 2 → every fund is measured over 24 months instead of 36 (fund-scorecard.js windowOf)
    "maxNavAgeDays": (1, 30),
    "minPeers": (3, 50),
    "minAumCr": (0, 100000),
}
MAX_BYTES = 4096
PASSWORD_ITERATIONS = 600_000
MIN_PASSWORD_LENGTH = 8
PASSWORD_KEY = "SCORECARD_PASSWORD_HASH"
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class SettingsError(ValueError):
    pass


def validate(raw) -> dict:
    if not isinstance(raw, dict) or set(raw) - {"weights", "conditions"}:
        raise SettingsError("settings must be {weights, conditions}")
    weights, conditions = raw.get("weights"), raw.get("conditions")
    if not isinstance(weights, dict) or set(weights) != set(PILLARS):
        raise SettingsError(f"weights must give exactly: {', '.join(PILLARS)}")
    if not isinstance(conditions, dict) or set(conditions) != set(CONDITIONS):
        raise SettingsError(f"conditions must give exactly: {', '.join(CONDITIONS)}")
    clean_w = {}
    for key in PILLARS:
        value = weights[key]
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100:
            raise SettingsError(f"weight {key} must be a whole number from 0 to 100")
        clean_w[key] = value
    if sum(clean_w.values()) != 100:
        raise SettingsError(f"weights total {sum(clean_w.values())}, they must total 100")
    clean_c = {}
    for key, (low, high) in CONDITIONS.items():
        value = conditions[key]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value != value or not low <= value <= high:
            raise SettingsError(f"condition {key} must be a number from {low} to {high}")
        clean_c[key] = int(value) if float(value).is_integer() else value
    return {"weights": clean_w, "conditions": clean_c}


def read(path: Path = SETTINGS_FILE) -> dict:
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
        return {**validate({"weights": stored.get("weights"), "conditions": stored.get("conditions")}), "updatedAt": stored.get("updatedAt")}
    except (OSError, ValueError, AttributeError):
        return {}


def save(raw, path: Path = SETTINGS_FILE) -> dict:
    clean = {**validate(raw), "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return clean


# ---------- edit password ----------
def hash_password(password: str, salt: bytes | None = None, iterations: int = PASSWORD_ITERATIONS) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password, stored: str | None) -> bool:
    if not isinstance(password, str) or not password or not stored:
        return False
    try:
        scheme, iterations, salt, expected = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except ValueError:
        return False


def stored_hash() -> str | None:
    import settings   # data-pipeline/settings.py: reads .env (git-ignored)
    return settings.load().get(PASSWORD_KEY) or None


def write_hash(value: str, env_file: Path = ENV_FILE) -> None:
    """Sets PASSWORD_KEY in .env, keeping every other line as it is."""
    lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    lines = [line for line in lines if not line.strip().startswith(f"{PASSWORD_KEY}=")]
    lines.append(f"{PASSWORD_KEY}={value}")
    tmp = env_file.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, env_file)


def change(raw, stored: str | None, path: Path = SETTINGS_FILE) -> dict:
    """A save request {password, weights, conditions}: refused without the right password, then validated and saved."""
    if not isinstance(raw, dict):
        raise SettingsError("settings must be {password, weights, conditions}")
    if not stored:
        raise SettingsError("No edit password is set yet — create one first (Edit → Create password)")
    if not verify_password(raw.get("password"), stored):
        time.sleep(1)
        raise SettingsError("Incorrect password")
    return save({k: v for k, v in raw.items() if k != "password"}, path)


PASSWORD_FINAL = True   # the owner fixed the password on 2026-10-28: once set, the page cannot change it


def set_password(raw, stored: str | None, env_file: Path = ENV_FILE, final: bool = PASSWORD_FINAL) -> dict:
    """Create the edit password (only while none is set). Changing it is closed while `final` (the owner's decision);
    otherwise the current password must be given. Only the hash is written."""
    if not isinstance(raw, dict):
        raise SettingsError("request must be {password, confirm, current?}")
    new, confirm = raw.get("password"), raw.get("confirm")
    if stored and final:
        raise SettingsError("The edit password is final and cannot be changed from the page")
    if stored and not verify_password(raw.get("current"), stored):
        time.sleep(1)
        raise SettingsError("Current password is incorrect")
    if not isinstance(new, str) or len(new) < MIN_PASSWORD_LENGTH:
        raise SettingsError(f"Use at least {MIN_PASSWORD_LENGTH} characters")
    if new != confirm:
        raise SettingsError("The two passwords do not match")
    write_hash(hash_password(new), env_file)
    return {"ok": True, "changed": bool(stored)}


def read_body() -> dict:
    body = sys.stdin.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise SettingsError("request too large")
    return json.loads(body.lstrip("﻿"))   # a byte-order mark is ignored


def main(argv: list[str]) -> int:
    if argv[:1] == ["get"]:
        can_edit = "--can-edit=true" in argv[1:]
        sys.stdout.write(json.dumps({"canEdit": can_edit, "passwordSet": bool(stored_hash()), "settings": read()}))
        return 0
    if argv == ["set-password"]:
        if PASSWORD_FINAL and stored_hash():
            print("The edit password is final — nothing changed.")
            return 2
        first = getpass.getpass("New Fund Scorecard edit password: ")
        if len(first) < MIN_PASSWORD_LENGTH:
            print(f"Use at least {MIN_PASSWORD_LENGTH} characters — nothing changed.")
            return 2
        if getpass.getpass("Type it again: ") != first:
            print("The two entries differ — nothing changed.")
            return 2
        write_hash(hash_password(first))
        print("Edit password set (only its hash is stored in .env).")
        return 0
    if argv == ["verify"]:
        try:
            raw = read_body()
            stored = stored_hash()
            if not stored:
                raise SettingsError("No edit password is set yet — create one first (Edit → Create password)")
            if not verify_password(raw.get("password") if isinstance(raw, dict) else None, stored):
                time.sleep(1)
                raise SettingsError("Incorrect password")
            sys.stdout.write(json.dumps({"ok": True}))
            return 0
        except (SettingsError, ValueError) as error:
            sys.stdout.write(json.dumps({"error": str(error)}))
            return 2
    if argv == ["password"]:
        try:
            sys.stdout.write(json.dumps(set_password(read_body(), stored_hash())))
            return 0
        except (SettingsError, ValueError) as error:
            sys.stdout.write(json.dumps({"error": str(error)}))
            return 2
    if argv == ["set"]:
        try:
            sys.stdout.write(json.dumps(change(read_body(), stored_hash())))
            return 0
        except (SettingsError, ValueError) as error:
            sys.stdout.write(json.dumps({"error": str(error)}))
            return 2
    sys.stdout.write(json.dumps({"error": "usage: get --can-edit=… | verify | set | password | set-password"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
