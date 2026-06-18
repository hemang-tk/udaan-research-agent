"""Object-vault access for Phase 5 (issue #24).

The parser reads a PDF directly from the MinIO/S3 vault by storage pointer
(``s3://bucket/key``) instead of receiving base64 bytes over HTTP, so a batch of
large PDFs is never buffered in the orchestrator or inflated ~33% by base64.
The S3 client is lazily imported (optional ``s3`` extra); an in-memory store
backs tests and no-infra runs."""

from __future__ import annotations

from typing import Protocol
from urllib.parse import urlparse


def parse_s3_pointer(pointer: str) -> tuple[str, str]:
    """Split ``s3://bucket/key`` into ``(bucket, key)``."""
    parsed = urlparse(pointer)
    if parsed.scheme != "s3":
        raise ValueError(f"unsupported storage pointer scheme: {pointer!r}")
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise ValueError(f"malformed s3 storage pointer: {pointer!r}")
    return bucket, key


class ObjectStore(Protocol):
    def get(self, pointer: str) -> bytes | None: ...


class InMemoryObjectStore:
    """In-memory vault keyed by full pointer (tests / no-infra)."""

    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}

    def put(self, pointer: str, data: bytes) -> None:
        self._objects[pointer] = data

    def get(self, pointer: str) -> bytes | None:
        return self._objects.get(pointer)


class S3ObjectStore:
    """Reads objects from MinIO/S3 by pointer. Path-style addressing matches the
    orchestrator's S3 client (MinIO-compatible)."""

    def __init__(self, *, endpoint: str, region: str, access_key: str, secret_key: str) -> None:
        import boto3
        from botocore.config import Config as BotoConfig

        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=BotoConfig(s3={"addressing_style": "path"}),
        )

    @classmethod
    def from_config(cls, s3) -> "S3ObjectStore":
        return cls(
            endpoint=s3.endpoint,
            region=s3.region,
            access_key=s3.access_key,
            secret_key=s3.secret_key,
        )

    def get(self, pointer: str) -> bytes | None:
        bucket, key = parse_s3_pointer(pointer)
        try:
            resp = self._client.get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        except Exception:
            return None
