"""Phase 5 reads PDFs from the vault by pointer (issue #24): the parser pulls
bytes from an injected object store instead of receiving base64 over HTTP."""

import json

import pytest
from udaan_parsing.chunking import Chunk
from udaan_parsing.ingest import ingest_from_pointer
from udaan_parsing.objstore import InMemoryObjectStore, parse_s3_pointer
from udaan_parsing.store import InMemoryClaimStore
from udaan_shared import HashingEmbeddingProvider


class StubLLM:
    def complete(self, messages, *, system=None, json_schema=None, max_tokens=None) -> str:
        return json.dumps(
            {
                "claims": [
                    {
                        "claimText": "caching cut latency ~30%",
                        "sourceQuote": "reduced latency by 30%",
                        "claimClassification": "FINDING",
                    }
                ]
            }
        )


def fake_parse(data: bytes) -> list[Chunk]:
    assert data == b"%PDF-streamed-from-vault"
    return [Chunk(text="Caching reduced latency by 30% under load.", section="Results", page_number=3)]


def test_parse_s3_pointer_splits_bucket_and_key():
    assert parse_s3_pointer("s3://research-vault/raw_pdfs/10.1_x.pdf") == (
        "research-vault",
        "raw_pdfs/10.1_x.pdf",
    )


@pytest.mark.parametrize("bad", ["http://x/y", "s3://only-bucket", "not-a-pointer"])
def test_parse_s3_pointer_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        parse_s3_pointer(bad)


def test_ingest_from_pointer_reads_bytes_from_injected_store():
    objstore = InMemoryObjectStore()
    pointer = "s3://research-vault/raw_pdfs/10.1_x.pdf"
    objstore.put(pointer, b"%PDF-streamed-from-vault")
    claims = ingest_from_pointer(
        pointer,
        "10.1/x",
        "proj_1",
        object_store=objstore,
        parse=fake_parse,
        llm=StubLLM(),
        embed=HashingEmbeddingProvider(),
        store=InMemoryClaimStore(),
    )
    assert len(claims) == 1
    assert claims[0].vector_embedding is not None


def test_ingest_from_pointer_raises_when_object_missing():
    with pytest.raises(FileNotFoundError):
        ingest_from_pointer(
            "s3://research-vault/missing.pdf",
            None,
            "proj_1",
            object_store=InMemoryObjectStore(),
            parse=fake_parse,
            llm=StubLLM(),
            embed=HashingEmbeddingProvider(),
            store=InMemoryClaimStore(),
        )
