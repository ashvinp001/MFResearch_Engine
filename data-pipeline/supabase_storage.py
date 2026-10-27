"""Supabase Storage — minimal client for one bucket (standard library only).

Input:  settings.supabase() — SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET from .env.
Output: StorageClient with ensure_bucket(), upload(path, bytes, type), download(path) -> bytes | None,
        delete(path), upload_json / download_json.

The service key bypasses row-level security, so it is used only by the pipeline scripts — never in
the website — and is sent only to the project's own URL. Requests retry 3 times (2 s / 8 s / 30 s)
on network errors and HTTP 5xx / 429; any other refusal stops with the server's message.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT_SECONDS = 60
RETRY_DELAYS_SECONDS = (2, 8, 30)
JSON_TYPE = "application/json"
PARQUET_TYPE = "application/vnd.apache.parquet"


class StorageError(RuntimeError):
    pass


class StorageClient:
    def __init__(self, settings: dict):
        self.base = f"{settings['url']}/storage/v1"
        self.bucket = settings["bucket"]
        key = settings["serviceKey"]
        # New-style secret keys (sb_secret_…) go in the apikey header only; legacy JWT keys also as Bearer.
        self.headers = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}

    def _request(self, method: str, url: str, body: bytes | None = None, headers: dict | None = None) -> bytes:
        last_error: Exception | None = None
        for delay in (0, *RETRY_DELAYS_SECONDS):
            if delay:
                time.sleep(delay)
            request = urllib.request.Request(url, data=body, method=method, headers={**self.headers, **(headers or {})})
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                    return response.read()
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:300]
                if error.code < 500 and error.code != 429:  # a real refusal: do not retry
                    raise StorageError(f"{method} {url.replace(self.base, '')} -> HTTP {error.code}: {detail}") from error
                last_error = StorageError(f"HTTP {error.code}: {detail}")
            except Exception as error:  # network trouble: retried, then reported
                last_error = error
        raise StorageError(f"{method} {url.replace(self.base, '')} failed after retries: {last_error}")

    def _object_url(self, path: str, authenticated: bool = False) -> str:
        middle = "object/authenticated" if authenticated else "object"
        return f"{self.base}/{middle}/{urllib.parse.quote(self.bucket)}/{urllib.parse.quote(path)}"

    def ensure_bucket(self) -> str:
        """Create the bucket as PRIVATE if it does not exist. Returns 'exists' or 'created'."""
        try:
            self._request("GET", f"{self.base}/bucket/{urllib.parse.quote(self.bucket)}")
            return "exists"
        except StorageError as error:
            if "HTTP 404" not in str(error) and "HTTP 400" not in str(error):
                raise
        payload = json.dumps({"id": self.bucket, "name": self.bucket, "public": False}).encode()
        self._request("POST", f"{self.base}/bucket", payload, {"Content-Type": JSON_TYPE})
        return "created"

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        self._request("POST", self._object_url(path), data,
                      {"Content-Type": content_type, "x-upsert": "true", "Cache-Control": "no-cache"})

    def download(self, path: str) -> bytes | None:
        """The object's bytes, or None when it does not exist. Always the stored version: Supabase's CDN can serve
        an earlier copy of an overwritten object for a while (seen 22-Oct-2026), so every read carries a unique
        query string, which bypasses that cache."""
        try:
            return self._request("GET", f"{self._object_url(path, authenticated=True)}?fresh={time.time_ns()}")
        except StorageError as error:
            if "HTTP 404" in str(error) or ("HTTP 400" in str(error) and "not_found" in str(error).lower()):
                return None
            raise

    def delete(self, path: str) -> None:
        payload = json.dumps({"prefixes": [path]}).encode()
        self._request("DELETE", f"{self.base}/object/{urllib.parse.quote(self.bucket)}", payload, {"Content-Type": JSON_TYPE})

    def upload_json(self, path: str, content) -> None:
        self.upload(path, json.dumps(content, ensure_ascii=False, indent=1).encode("utf-8"), JSON_TYPE)

    def download_json(self, path: str):
        data = self.download(path)
        return None if data is None else json.loads(data.decode("utf-8"))
