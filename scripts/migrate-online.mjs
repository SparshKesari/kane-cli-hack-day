// Applies db/online/*.sql to the ONLINE hackathon database only.
// Refuses to run against the SF Hack Day database (DATABASE_URL).
//   node --env-file=.env.local scripts/migrate-online.mjs
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const raw = process.env.ONLINE_DATABASE_URL_UNPOOLED ?? process.env.ONLINE_DATABASE_URL;
if (!raw) throw new Error("ONLINE_DATABASE_URL is not set.");
const same = (a, b) => a && b && a.split("?")[0] === b.split("?")[0];
if (same(raw, process.env.DATABASE_URL) || same(raw, process.env.DATABASE_URL_UNPOOLED)) {
  throw new Error("ONLINE_DATABASE_URL points at the SF Hack Day database. Use a separate database.");
}

const client = new pg.Client({ connectionString: raw.replace("sslmode=require", "sslmode=verify-full") });
await client.connect();
try {
  const dir = new URL("../db/online/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.query(await readFile(new URL(file, dir), "utf8"));
    console.log(`applied online/${file}`);
  }
} finally {
  await client.end();
}
