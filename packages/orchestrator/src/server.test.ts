import { describe, expect, it } from "vitest";
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
});
