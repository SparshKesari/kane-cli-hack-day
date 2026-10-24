import "server-only";
import { AppError } from "./core";
import { getRoster, getTeamInfo } from "./teams";
import type { MemberRow } from "./auth";

// Shared bits for the v2.5 build-reference endpoints (docs/api/plan-v2.5-endpoints.json).
// Endpoints whose backing piece doesn't exist yet answer 501 NOT_IMPLEMENTED
// with the reason, after the same auth check the real endpoint will need, so
// the contract callers see today is the one they'll get.

export function notImplemented(reason: string): never {
  throw new AppError("NOT_IMPLEMENTED", { userMessage: reason, details: { plan: "v2.5", tracking: "docs/api/ENDPOINTS.md" } });
}

/** A team by numeric id or slug, or NOT_FOUND. */
export async function teamByParam(id: string) {
  const t = /^\d+$/.test(id) ? await getTeamInfo({ id: Number(id) }) : await getTeamInfo({ slug: id });
  if (!t) throw new AppError("NOT_FOUND", { userMessage: "Team not found." });
  return t;
}

export async function assertOnTeam(teamId: number, member: MemberRow) {
  if (!(await getRoster(teamId)).some((r) => r.member_id === member.id)) throw new AppError("FORBIDDEN", { userMessage: "You're not on this team." });
}
