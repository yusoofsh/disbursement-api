import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
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
  });

  it("serves the Swagger UI HTML at /documentation", async () => {
    const res = await inject(app, { method: "GET", url: "/documentation" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("swagger-ui");
  });
});
