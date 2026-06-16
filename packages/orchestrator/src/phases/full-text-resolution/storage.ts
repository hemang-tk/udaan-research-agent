/**
 * Object storage for the PDF vault (Phase 4). MinIO/S3 in real runs;
 * in-memory for tests and no-infra. The S3 client targets MinIO locally and a
 * real bucket at deploy via the same config (storagePointer stays s3://...).
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3Config } from "@udaan/shared";
import type { ObjectStore } from "./types.js";

/** Build a safe object key for a paper's PDF. */
export function storageKey(doi: string | null, internalId: string): string {
  const base = (doi ?? internalId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `raw_pdfs/${base}.pdf`;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly store = new Map<string, Uint8Array>();

  constructor(private readonly bucket = "research-vault") {}

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<string> {
    this.store.set(key, bytes);
    return this.pointerFor(key);
  }

  pointerFor(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }

  /** Test helper. */
  read(key: string): Uint8Array | undefined {
    return this.store.get(key);
  }
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly s3: S3Config) {
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true, // required for MinIO
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.s3.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.s3.bucket, Key: key }));
      if (!res.Body) return null;
      return await res.Body.transformToByteArray();
    } catch {
      return null;
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.s3.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
    return this.pointerFor(key);
  }

  pointerFor(key: string): string {
    return `s3://${this.s3.bucket}/${key}`;
  }
}
