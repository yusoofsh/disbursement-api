import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { Env } from "../../config/env.js";
import type { User, UserRole } from "../../db/schema.js";
import { errors } from "../../shared/errors/app-error.js";
import { sha256 } from "../../shared/utils/hash.js";
import type { AuthRepository } from "./auth.repository.js";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: "refresh";
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2];
  const factor = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return value * factor;
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly env: Env,
  ) {}

  private signAccessToken(user: User): { token: string; expiresIn: number } {
    const expiresIn = ttlToSeconds(this.env.JWT_ACCESS_TTL);
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role as UserRole },
      this.env.JWT_ACCESS_SECRET,
      { expiresIn },
    );
    return { token, expiresIn };
  }

  private async issueRefreshToken(user: User): Promise<string> {
    const expiresInSec = ttlToSeconds(this.env.JWT_REFRESH_TTL);
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { sub: user.id, jti, type: "refresh" } satisfies RefreshTokenPayload,
      this.env.JWT_REFRESH_SECRET,
      { expiresIn: expiresInSec },
    );
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    await this.repo.createRefreshToken(user.id, sha256(token), expiresAt);
    return token;
  }

  async login(username: string, password: string): Promise<TokenPair> {
    const user = await this.repo.findUserByUsername(username);
    if (!user) {
      throw errors.unauthorized("Invalid username or password.");
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw errors.unauthorized("Invalid username or password.");
    }
    const { token, expiresIn } = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    return { access_token: token, refresh_token: refreshToken, token_type: "Bearer", expires_in: expiresIn };
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(token, this.env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    } catch {
      throw errors.unauthorized("The refresh token is invalid or expired.");
    }
    if (payload.type !== "refresh") {
      throw errors.unauthorized("The refresh token is invalid or expired.");
    }
    return payload;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = this.verifyRefreshToken(refreshToken);
    const stored = await this.repo.findValidRefreshToken(sha256(refreshToken));
    if (!stored || stored.userId !== payload.sub) {
      throw errors.unauthorized("The refresh token has been revoked or is unknown.");
    }
    const user = await this.repo.findUserById(payload.sub);
    if (!user) {
      throw errors.unauthorized("The token owner no longer exists.");
    }
    // Rotate: revoke the presented token and issue a fresh pair.
    await this.repo.revokeRefreshToken(sha256(refreshToken));
    const { token, expiresIn } = this.signAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(user);
    return { access_token: token, refresh_token: newRefreshToken, token_type: "Bearer", expires_in: expiresIn };
  }

  async logout(refreshToken: string): Promise<void> {
    // Verify signature first so arbitrary strings are rejected as 401.
    this.verifyRefreshToken(refreshToken);
    await this.repo.revokeRefreshToken(sha256(refreshToken));
  }
}
