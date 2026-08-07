import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { buildApp } from "../../src/app.js";
import { createTestApp, inject, resetDatabase } from "../helpers/test-app.js";

describe("swagger/openapi", () => {
  let app: App;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the OpenAPI JSON at /documentation/json with the expected paths", async () => {
    const res = await inject(app, { method: "GET", url: "/documentation/json" });

    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(typeof doc.openapi).toBe("string");
    expect(doc.openapi.startsWith("3.")).toBe(true);
    // No hardcoded server URL: Swagger UI falls back to the page origin.
    expect(doc.servers).toBeUndefined();
    expect(doc.paths["/auth/login"]).toBeDefined();
    expect(doc.paths["/disbursements"]).toBeDefined();
    expect(doc.paths["/disbursements/batch"]).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();

    const create = doc.paths["/disbursements"].post;
    expect(create.tags).toEqual(["disbursements"]);
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(create.parameters).toContainEqual(
      expect.objectContaining({ name: "idempotency-key", in: "header", required: false }),
    );
    expect(doc.paths["/auth/login"].post.tags).toEqual(["auth"]);
    expect(doc.paths["/auth/login"].post.security).toBeUndefined();

    // Response schemas are documented for the key routes.
    expect(create.responses["201"].content["application/json"].schema.properties.data.properties.admin_fee.enum).toEqual([2500, 5000]);
    expect(create.responses["409"]).toBeDefined();
    expect(doc.paths["/auth/login"].post.responses["200"].content["application/json"].schema.properties.data.properties.access_token).toBeDefined();
    expect(doc.paths["/disbursements"].get.responses["200"].content["application/json"].schema.properties.meta.properties.total_pages).toBeDefined();
    expect(doc.paths["/audit-logs"].get.responses["403"]).toBeDefined();
  });

  it("serves the Swagger UI HTML at /documentation", async () => {
    const res = await inject(app, { method: "GET", url: "/documentation" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("swagger-ui");
  });

  it("advertises PUBLIC_URL in the OpenAPI servers list when configured", async () => {
    const publicApp = await buildApp(loadEnv({ ...process.env, PUBLIC_URL: "https://docs.example.com" }));
    try {
      const res = await inject(publicApp, { method: "GET", url: "/documentation/json" });

      expect(res.statusCode).toBe(200);
      const doc = res.json();
      expect(doc.servers).toEqual([{ url: "https://docs.example.com" }]);
    } finally {
      await publicApp.close();
    }
  });
});
