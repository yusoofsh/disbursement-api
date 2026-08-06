import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import {
  bearer,
  createDisbursementPayload,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("rate limiting", () => {
  let app: App;
  let operator: TokenPair;

  beforeAll(async () => {
    await resetDatabase();
    app = await buildApp(
      loadEnv({
        ...process.env,
        RATE_LIMIT_MAX: "100",
        RATE_LIMIT_LOGIN_MAX: "3",
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 429 RATE_LIMITED with the standard error shape after exceeding the login limit", async () => {
    // loginAs consumes one of the three allowed slots; two more requests pass,
    // and the fourth is rate limited.
    operator = await loginAs(app, "operator");

    for (let i = 0; i < 2; i++) {
      const ok = await inject(app, {
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "wrong-password" },
      });
      expect(ok.statusCode).toBe(401);
    }

    const limited = await inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      success: false,
      error: { code: "RATE_LIMITED", message: expect.any(String) },
    });
  });

  it("keys authenticated routes by user id, not by IP", async () => {
      // A separate app so the login-limit buckets do not interfere. The PDF
      // requires POST /disbursements at 30/min per user; with RATE_LIMIT_CREATE_MAX
      // set to 3, the operator's fourth create is limited while the admin (same
      // IP, different user) still succeeds.
      const app2 = await buildApp(
        loadEnv({
          ...process.env,
          RATE_LIMIT_CREATE_MAX: "3",
          RATE_LIMIT_LOGIN_MAX: "100",
        }),
    );
    try {
      const op = await loginAs(app2, "operator");
      const adm = await loginAs(app2, "admin");
      const create = (token: string, recipient_name: string) =>
        inject(app2, {
          method: "POST",
          url: "/disbursements",
          headers: bearer(token),
          payload: createDisbursementPayload({ recipient_name }),
        });

      for (let i = 0; i < 3; i++) {
        expect((await create(op.access_token, `RL-Operator-${i}`)).statusCode).toBe(201);
      }
      const limited = await create(op.access_token, "RL-Operator-4th");
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe("RATE_LIMITED");

      const adminCreate = await create(adm.access_token, "RL-Admin");
      expect(adminCreate.statusCode).toBe(201);
    } finally {
      await app2.close();
    }
  });
});
