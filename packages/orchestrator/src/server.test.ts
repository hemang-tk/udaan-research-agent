import { describe, expect, it } from "vitest";
import { InMemoryObjectStore } from "./phases/full-text-resolution/index.js";
import { buildServer } from "./server.js";

describe("orchestrator API", () => {
  it("reports health", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("rejects a research request with no query", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "POST", url: "/research", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404s an unknown job", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/research/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("stores a paywalled PDF upload in the vault", async () => {
    const store = new InMemoryObjectStore();
    const app = buildServer({ store });
    const pdfBase64 = Buffer.from(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])).toString("base64");
    const res = await app.inject({ method: "POST", url: "/uploads", payload: { doi: "10.1/x", internalId: "p1", pdfBase64 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stored).toBe(true);
    expect(await store.get("raw_pdfs/10.1_x.pdf")).not.toBeNull();
    await app.close();
  });

  it("rejects a non-PDF upload", async () => {
    const app = buildServer({ store: new InMemoryObjectStore() });
    const pdfBase64 = Buffer.from("just text").toString("base64");
    const res = await app.inject({ method: "POST", url: "/uploads", payload: { doi: null, internalId: "p1", pdfBase64 } });
    expect(res.statusCode).toBe(415);
    await app.close();
  });
});
