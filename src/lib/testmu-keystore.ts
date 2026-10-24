import { Pool } from "pg";
import { keyFingerprint, type KeyCredentials } from "./testmu-gate";

// The proxy's read of testmu_links: is this username + access key one TestMu
// gave us (by provisioning) or one we already verified? Matches on the key's
// fingerprint, so the key itself is never stored or compared in the clear.
// Its own small pool: src/lib/db.ts is server-only and src/proxy.ts can't use it.

let pool: Pool | null = null;
function db() {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"), max: 2 });
  return pool;
}

export type KnownKey = { memberId: number | null };

/** The link row for these credentials, or null (unknown username, other key, or revoked). */
export async function findKnownKey(c: KeyCredentials): Promise<KnownKey | null> {
  const { rows } = await db().query<{ member_id: number | null }>(
    "select member_id from testmu_links where lower(testmu_username) = lower($1) and key_fingerprint = $2 and revoked_at is null",
    [c.username, keyFingerprint(c)],
  );
  return rows[0] ? { memberId: rows[0].member_id == null ? null : Number(rows[0].member_id) } : null;
}
