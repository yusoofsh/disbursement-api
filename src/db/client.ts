import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

// drizzle 1.x dropped the schema config from the pg driver; the repositories
// use the classic query API only, so no schema is needed here.
export type Db = NodePgDatabase;

export function createDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });
  return { db, pool };
}
