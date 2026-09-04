"""Photo upload helper: S3-style interface, Supabase backend today, R2 tomorrow.

Swap rule (per plan): changing to Cloudflare R2 = implement R2Storage with the
same two methods and switch get_storage() — no route/app changes.
"""

import os
from abc import ABC, abstractmethod

from .config import settings


class StorageBackend(ABC):
    @abstractmethod
    def upload(self, key: str, data: bytes, content_type: str) -> str:
        """Upload bytes, return stored path/URL."""

    @abstractmethod
    def signed_url(self, key: str, expires_s: int = 3600) -> str: ...


class SupabaseStorage(StorageBackend):
    def __init__(self):
        from supabase import create_client

        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_URL/SUPABASE_SERVICE_KEY not set")
        self.client = create_client(
            settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY
        )
        self.bucket = settings.STORAGE_BUCKET

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        # supabase-py storage: bucket/key layout. key e.g. "{incident_id}.jpg"
        self.client.storage.from_(self.bucket).upload(
            key, data, {"content-type": content_type, "upsert": "true"}
        )
        return f"{self.bucket}/{key}"

    def signed_url(self, key: str, expires_s: int = 3600) -> str:
        res = self.client.storage.from_(self.bucket).create_signed_url(key, expires_s)
        return res.get("signedURL", res.get("signedUrl", ""))


class LocalStorage(StorageBackend):
    """Dev/test fallback when Supabase keys are absent. Serves acceptance test."""

    def __init__(self, root: str = "./uploads"):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        path = os.path.join(self.root, key.replace("/", "_"))
        with open(path, "wb") as f:
            f.write(data)
        return path

    def signed_url(self, key: str, expires_s: int = 3600) -> str:
        return f"/uploads/{key}"


class R2Storage(StorageBackend):
    """TODO: future Cloudflare R2 move — boto3 put_object/get_presigned_url here."""

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        raise NotImplementedError("R2 not configured; set S3_* env and implement")

    def signed_url(self, key: str, expires_s: int = 3600) -> str:
        raise NotImplementedError("R2 not configured")


def get_storage() -> StorageBackend:
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY:
        try:
            return SupabaseStorage()
        except Exception:
            pass
    if settings.S3_ENDPOINT and settings.S3_BUCKET:
        return R2Storage()
    return LocalStorage()
