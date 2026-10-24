import { envelopeResponse } from "@/server/core";
import { getTeamPage, pageCaller, teamPageEnvelope, updateTeamPage } from "@/server/team-page";
import { readBody } from "../../body";

// GET|PUT /api/v1/teams/{id|slug}/page   The team submission page, shown at /ship/{slug} (contract: docs/api/TEAM_PAGE.md)
//   GET  readback: canonical_url, visibility, page_version, every field, resolved
//        public evidence, one_pager_url and statuses. Team members and staff.
//   PUT  idempotent upsert, every field optional (omitted = unchanged, null = clears):
//        { repo_url, commit_sha, one_pager_html, video: {public_evidence_id} | {url},
//          deck: {version} | {hosted: true}, evidence_ids: ["PE-n"], kane_run_ids,
//          share_links, expected_version, idempotency_key } (or the Idempotency-Key header).
//        Team members, or organizers (also after the lock). Stale expected_version → 409.
//        Never publishes: a person publishes in the browser (actions[].requires_human_confirmation).

export async function GET(req: Request, { params }: RouteContext<"/api/v1/teams/[id]/page">) {
  return envelopeResponse(async () => teamPageEnvelope(await getTeamPage((await params).id, await pageCaller(req))));
}

export async function PUT(req: Request, { params }: RouteContext<"/api/v1/teams/[id]/page">) {
  return envelopeResponse(async () => {
    const caller = await pageCaller(req);
    return teamPageEnvelope(await updateTeamPage((await params).id, caller, await readBody(req)));
  });
}
