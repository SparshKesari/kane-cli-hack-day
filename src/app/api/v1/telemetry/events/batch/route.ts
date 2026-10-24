import { envelopeResponse } from "@/server/core";
import { resolveCaller } from "@/server/kane";
import { notImplemented } from "@/server/plan-v25";

// POST /api/v1/telemetry/events/batch   participant or paired CLI
// v2.5 plan: Batch of allowlisted Codex hook events from the local outbox (idempotent per event_id).
// Not built yet: answers 501 NOT_IMPLEMENTED (after the auth the real endpoint needs).

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    await resolveCaller(req);
    notImplemented("Hook telemetry ingest isn't built: it needs the metadata-only, consent-checked endpoint described in plugin/hooks/README.md. Report runs with `kanehack report` (POST /api/v1/kane/runs).");
  });
}
