"""Settings for the data pipeline — read from the project's .env file (git-ignored).

Real environment variables win over .env, so a scheduled job (e.g. GitHub Actions secrets) can supply
the same names without a file. Secrets are never printed: describe() shows only whether each is set.

Keys (see .env.example):
  SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET           — where all fund data is stored
  SUPABASE_BENCHMARK_BUCKET                                     — benchmark data (default benchmark-data)
  MFAPI_BASE_URL, AMFI_NAV_URL, AMFI_SCHEME_MASTER_URL,
  AMFI_NAV_HISTORY_URL                                          — public data sources (no key)
  PULSE_BASE_URL, PULSE_PARTNER, PULSE_KEY                      — Pulse Labs fund analytics API
  SCORECARD_PASSWORD_HASH                                       — Fund Scorecard edit password (hash only; set it with
                                                                  python data-pipeline/scorecard_settings.py set-password)
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"

DEFAULTS = {
    "SUPABASE_BUCKET": "mf-data",
    "SUPABASE_BENCHMARK_BUCKET": "benchmark-data",
    "MFAPI_BASE_URL": "https://api.mfapi.in/mf/",
    "AMFI_NAV_URL": "https://portal.amfiindia.com/spages/NAVOpen.txt",
    "AMFI_SCHEME_MASTER_URL": "https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0",
    "AMFI_NAV_HISTORY_URL": "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt={start}&todt={end}",
    "PULSE_BASE_URL": "https://pulsedb.pulselabs.co.in/rest/api/v1",
}
SECRET_KEYS = {"SUPABASE_SERVICE_KEY", "PULSE_PARTNER", "PULSE_KEY", "SCORECARD_PASSWORD_HASH"}
OPTIONAL_KEYS = {"SUPABASE_URL", "PULSE_PARTNER", "PULSE_KEY", "SCORECARD_PASSWORD_HASH"}  # no default; required only where used


class SettingsError(RuntimeError):
    pass


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SettingsError(f".env line {number} is not KEY=value")
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load(path: Path = ENV_FILE) -> dict[str, str]:
    values = {**DEFAULTS, **{k: v for k, v in _read_env_file(path).items() if v}}
    values.update({k: v for k, v in os.environ.items() if k in values or k in SECRET_KEYS or k in OPTIONAL_KEYS})
    return values


def get(name: str, settings: dict[str, str] | None = None) -> str:
    value = (settings or load()).get(name, "")
    if not value:
        raise SettingsError(f"{name} is not set — add it to .env (see .env.example)")
    return value


def supabase(settings: dict[str, str] | None = None, bucket_key: str = "SUPABASE_BUCKET") -> dict[str, str]:
    """Connection for one bucket: SUPABASE_BUCKET (fund data) or SUPABASE_BENCHMARK_BUCKET (benchmark data)."""
    settings = settings or load()
    url = get("SUPABASE_URL", settings).rstrip("/")
    if not url.startswith("https://"):
        raise SettingsError("SUPABASE_URL must start with https://")
    return {"url": url, "serviceKey": get("SUPABASE_SERVICE_KEY", settings), "bucket": get(bucket_key, settings)}


def describe(settings: dict[str, str] | None = None) -> str:
    settings = settings or load()
    names = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_BUCKET",
             *[k for k in DEFAULTS if k != "SUPABASE_BUCKET"], "PULSE_PARTNER", "PULSE_KEY"]  # incl. SUPABASE_BENCHMARK_BUCKET
    return "\n".join(f"  {name}: {'set' if settings.get(name) else 'MISSING'}"
                     + ("" if name in SECRET_KEYS or not settings.get(name) else f" ({settings[name]})") for name in names)
