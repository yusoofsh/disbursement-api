import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  createTestApp,
  inject,
  loginAs,
  resetDatabase,
  SEED_USERS,
  type TokenPair,
} from "../helpers/test-app.js";

describe("auth", () => {
  let app: App;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("login returns access and refresh tokens", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { username: "admin", password: "admin123" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as TokenPair;
    expect(data.token_type).toBe("Bearer");
    expect(data.expires_in).toBe(900);
    expect(typeof data.access_token).toBe("string");
    expect(data.access_token.length).toBeGreaterThan(0);
    expect(typeof data.refresh_token).toBe("string");
    expect(data.refresh_token.length).toBeGreaterThan(0);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown username with 401", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { username: "ghost", password: "whatever123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refresh issues a new pair and rotates (old refresh token fails after use)", async () => {
    const tokens = await loginAs(app, "admin");

    const refreshRes = await inject(app, {
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refreshRes.statusCode).toBe(200);
    const rotated = refreshRes.json().data as TokenPair;
    expect(rotated.access_token.length).toBeGreaterThan(0);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    // The rotated token works.
    const secondRefresh = await inject(app, {
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: rotated.refresh_token },
    });
    expect(secondRefresh.statusCode).toBe(200);

    // The original refresh token was revoked by rotation.
    const reuse = await inject(app, {
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("logout revokes the refresh token; reuse fails with 401", async () => {
    const tokens = await loginAs(app, "operator");

    const logoutRes = await inject(app, {
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().data.message).toBe("Logged out successfully.");

    const reuse = await inject(app, {
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("login works for all seeded users", async () => {
    for (const role of ["superadmin", "admin", "operator"] as const) {
      const { username, password } = SEED_USERS[role];
      const res = await inject(app, {
        method: "POST",
        url: "/auth/login",
        payload: { username, password },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
