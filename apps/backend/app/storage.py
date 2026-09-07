"""Photo upload helper backed exclusively by Supabase Storage."""

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


def get_storage() -> StorageBackend:
    # Photos are part of the Supabase-only data plane. Missing credentials are
    # surfaced to the caller instead of writing files to the local workspace.
    return SupabaseStorage()
