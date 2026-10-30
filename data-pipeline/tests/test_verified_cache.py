"""verified_cache: a cached file is used only while it matches the manifest's SHA-256."""

import hashlib
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import verified_cache  # noqa: E402


class FakeClient:
    def __init__(self, files, manifest=None):
        self.files = files
        self.manifest = manifest
        self.downloads = 0
        self.manifest_reads = 0

    def download(self, path):
        self.downloads += 1
        return self.files.get(path)

    def download_json(self, path):
        self.manifest_reads += 1
        return self.manifest


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class VerifiedCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = os.environ.get("LOCALAPPDATA")
        os.environ["LOCALAPPDATA"] = self.tmp.name

    def tearDown(self):
        if self.old is None:
            os.environ.pop("LOCALAPPDATA", None)
        else:
            os.environ["LOCALAPPDATA"] = self.old
        self.tmp.cleanup()

    def test_second_read_comes_from_the_cache(self):
        client = FakeClient({"a.parquet": b"v1"})
        self.assertEqual(verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b"), b"v1")
        self.assertEqual(verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b"), b"v1")
        self.assertEqual(client.downloads, 1)

    def test_a_new_manifest_hash_downloads_the_new_file(self):
        client = FakeClient({"a.parquet": b"v1"})
        verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b")
        client.files["a.parquet"] = b"v2"
        self.assertEqual(verified_cache.verified_bytes(client, "a.parquet", sha(b"v2"), "b"), b"v2")
        self.assertEqual(client.downloads, 2)

    def test_a_download_that_does_not_match_is_rejected_and_not_cached(self):
        client = FakeClient({"a.parquet": b"tampered"})
        self.assertIsNone(verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b"))
        self.assertEqual(list((verified_cache.cache_root() / "b").glob("*.parquet")), [])
        self.assertIsNone(verified_cache.verified_bytes(client, "a.parquet", "not-a-hash", "b"))

    def test_a_corrupted_cached_copy_is_replaced(self):
        client = FakeClient({"a.parquet": b"v1"})
        verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b")
        (verified_cache.cache_root() / "b" / f"{sha(b'v1')}.parquet").write_bytes(b"garbage")
        self.assertEqual(verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b"), b"v1")
        self.assertEqual(client.downloads, 2)

    def test_manifest_is_reused_within_its_ttl_and_refreshed_after(self):
        client = FakeClient({}, manifest={"files": [1]})
        self.assertEqual(verified_cache.cached_manifest(client, "m.json", "b"), {"files": [1]})
        verified_cache.cached_manifest(client, "m.json", "b")
        self.assertEqual(client.manifest_reads, 1)
        client.manifest = {"files": [2]}
        self.assertEqual(verified_cache.cached_manifest(client, "m.json", "b", ttl=0), {"files": [2]})

    def test_prune_removes_files_not_read_recently(self):
        client = FakeClient({"a.parquet": b"v1"})
        verified_cache.verified_bytes(client, "a.parquet", sha(b"v1"), "b")
        old = time.time() - 10 * 86400
        os.utime(verified_cache.cache_root() / "b" / f"{sha(b'v1')}.parquet", (old, old))
        self.assertEqual(verified_cache.prune("b"), 1)


if __name__ == "__main__":
    unittest.main()
