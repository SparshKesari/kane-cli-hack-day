import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, types, type QueryResultRow } from "pg";

// The online hackathon's own database. Deliberately a different env var and a
// different pool from src/lib/db.ts, so nothing here can read or write the SF
// Hack Day data (or the /ship pages built from it).

types.setTypeParser(types.builtins.INT8, Number);

let pool: Pool | null = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.ONLINE_DATABASE_URL;
  if (!url) throw new Error("ONLINE_DATABASE_URL is not set");
  if (url.split("?")[0] === process.env.DATABASE_URL?.split("?")[0]) {
    throw new Error("ONLINE_DATABASE_URL must not be the SF Hack Day database");
  }
  pool = new Pool({ connectionString: url.replace("sslmode=require", "sslmode=verify-full"), max: 5 });
  attachDatabasePool(pool);
  return pool;
}

export async function onlineQuery<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  const { rows } = await getPool().query<T>(text, params);
  return rows;
}
