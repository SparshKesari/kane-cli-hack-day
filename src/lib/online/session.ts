import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

// Signed cookie for an online-hackathon participant. Its own cookie name and
// its own HMAC context, so it can never be read as an SF Hack Day session.

const COOKIE = "ol_session";
const MAX_AGE = 60 * 60 * 24 * 30;

type Session = { pid: number; exp: number };

function key() {
  const s = process.env.ONLINE_SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (!s) throw new Error("ONLINE_SESSION_SECRET is not set");
  return `online:${s}`;
}

function mac(body: string) {
  return createHmac("sha256", key()).update(body).digest();
}

export async function setOnlineSession(participantId: number) {
  const body = Buffer.from(JSON.stringify({ pid: participantId, exp: Date.now() + MAX_AGE * 1000 } satisfies Session)).toString("base64url");
  (await cookies()).set(COOKIE, `${body}.${mac(body).toString("base64url")}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearOnlineSession() {
  const jar = await cookies();
  jar.set(COOKIE, "", { path: "/", maxAge: 0 });
}

export async function getOnlineSession(): Promise<number | null> {
  await connection(); // request-time only: the expiry check reads the clock
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s.pid : null;
  } catch {
    return null;
  }
}
