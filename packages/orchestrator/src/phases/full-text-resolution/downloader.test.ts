import { describe, expect, it } from "vitest";
import { downloadAndStore } from "./downloader.js";
import { InMemoryObjectStore } from "./storage.js";
import type { FetchLike } from "./types.js";

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const respond =
  (body: Uint8Array | string, contentType: string): FetchLike =>
  async () =>
    new Response(body, { headers: { "content-type": contentType } });

describe("downloadAndStore", () => {
  it("stores a valid PDF and reports RESOLVED_DOWNLOAD", async () => {
    const store = new InMemoryObjectStore();
    const outcome = await downloadAndStore(
      "https://x/p.pdf",
      "raw_pdfs/x.pdf",
      store,
      respond(pdfBytes, "application/pdf"),
    );
    expect(outcome.status).toBe("RESOLVED_DOWNLOAD");
    expect(outcome.pointer).toBe("s3://research-vault/raw_pdfs/x.pdf");
    expect(store.read("raw_pdfs/x.pdf")).toBeDefined();
  });

  it("flags an HTML login page as PAYWALLED", async () => {
    const store = new InMemoryObjectStore();
    const outcome = await downloadAndStore(
      "https://x/p",
      "k",
      store,
      respond("<html>login</html>", "text/html"),
    );
    expect(outcome.status).toBe("PAYWALLED");
    expect(outcome.pointer).toBeNull();
  });

  it("flags a non-PDF payload as FAILED_CORRUPTED", async () => {
    const store = new InMemoryObjectStore();
    const outcome = await downloadAndStore(
      "https://x/p.pdf",
      "k",
      store,
      respond(new Uint8Array([1, 2, 3]), "application/pdf"),
    );
    expect(outcome.status).toBe("FAILED_CORRUPTED");
  });
});
