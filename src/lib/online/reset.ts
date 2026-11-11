import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { onlineQuery } from "./db";
import { siteUrl } from "./email";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * A one-hour, single-use password reset link. Server-only on purpose: it must
 * never be callable from the browser (only the forgot-password flow and a
 * signed-in organiser may make one).
 */
export async function createResetLink(participantId: number) {
  const token = randomBytes(32).toString("base64url");
  await onlineQuery(`update online_participants set reset_token_hash = $2, reset_expires_at = now() + interval '1 hour' where id = $1`, [participantId, tokenHash(token)]);
  return `${siteUrl()}/o/reset/${token}`;
}
