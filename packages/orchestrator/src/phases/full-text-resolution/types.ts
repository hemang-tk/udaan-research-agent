/** Phase 4 — JIT Full-Text Resolution: local types. */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Abstraction over object storage so tests run without S3/MinIO. */
export interface ObjectStore {
  /** Track A cache check. */
  exists(key: string): Promise<boolean>;
  /** Stream/store bytes; returns the storage pointer. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** s3://bucket/key pointer for a key. */
  pointerFor(key: string): string;
}
