"""MFAPI.in — download one scheme's full NAV history.

Input:  MFAPI_BASE_URL (settings.py) and an AMFI scheme code.
Output: fetch_history(base_url, code) -> the parsed JSON {"meta": {...}, "data": [{"date": "dd-mm-yyyy", "nav": "90.35460"}, ...],
        "status": "SUCCESS"}. Values are returned exactly as MFAPI prints them; checking happens in nav_history.py.

MFAPI is a free public mirror of AMFI's NAV history (no key). Etiquette: real User-Agent, 60 s timeout,
3 retries with 2 s / 8 s / 30 s backoff; the caller paces requests.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ProsperrResearch/1.0"
TIMEOUT_SECONDS = 60
RETRY_DELAYS_SECONDS = (2, 8, 30)


class MfapiError(RuntimeError):
    """The scheme's history could not be downloaded (after retries) or is not valid JSON."""


def fetch_history(base_url: str, scheme_code: int) -> dict:
    """base_url = MFAPI_BASE_URL from .env, e.g. https://api.mfapi.in/mf/"""
    url = f"{base_url.rstrip('/')}/{int(scheme_code)}"
    last_error: Exception | None = None
    for delay in (0, *RETRY_DELAYS_SECONDS):
        if delay:
            time.sleep(delay)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = response.read()
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise MfapiError("response is not a JSON object")
            return payload
        except urllib.error.HTTPError as error:
            if error.code == 404:  # not a transient failure — do not retry
                raise MfapiError(f"MFAPI has no scheme {scheme_code} (HTTP 404)") from error
            last_error = error
        except Exception as error:  # timeouts, resets, truncated JSON: retried, then reported
            last_error = error
    raise MfapiError(f"could not download {url} after {len(RETRY_DELAYS_SECONDS) + 1} attempts: {last_error}")
