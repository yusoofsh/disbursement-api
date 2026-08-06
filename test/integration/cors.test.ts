import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { buildApp } from "../../src/app.js";
import { getTestEnv, inject, resetDatabase } from "../helpers/test-app.js";

describe("cors", () => {
  let app: App;

  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("sends no CORS headers when CORS_ORIGIN is empty", async () => {
    app = await buildApp(getTestEnv());
    const res = await inject(app, {
      method: "GET",
      url: "/health",
      headers: { origin: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reflects configured origins and exposes the request-id headers", async () => {
    await app.close();
    app = await buildApp({ ...getTestEnv(), CORS_ORIGIN: "https://www.yusoofsh.id, https://demo.example.com" });
    const res = await inject(app, {
      method: "GET",
      url: "/health",
      headers: { origin: "https://www.yusoofsh.id" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://www.yusoofsh.id");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Request-ID");
  });

  it("rejects a preflight from an origin not on the list", async () => {
    const res = await inject(app, {
      method: "OPTIONS",
      url: "/disbursements",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204); // plugin short-circuits; no allow-origin header
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
