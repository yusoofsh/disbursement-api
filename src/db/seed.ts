import argon2 from "argon2";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "../config/env.js";
import { createDb, type Db } from "./client.js";
import { users, type UserRole } from "./schema.js";

const SEED_USERS: Array<{ username: string; password: string; role: UserRole }> = [
  { username: "superadmin", password: "superadmin123", role: "superadmin" },
  { username: "admin", password: "admin123", role: "admin" },
  { username: "operator", password: "operator123", role: "operator" },
];

export async function seed(db: Db): Promise<void> {
  for (const u of SEED_USERS) {
    const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
    await db
      .insert(users)
      .values({ username: u.username, passwordHash, role: u.role })
      .onConflictDoUpdate({
        target: users.username,
        set: { passwordHash, role: u.role, updatedAt: new Date() },
      });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  seed(db)
    .then(async () => {
      console.log("Seeded users: superadmin, admin, operator");
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Seed failed:", err);
      await pool.end();
      process.exit(1);
    });
}
