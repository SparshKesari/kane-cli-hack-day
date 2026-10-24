import "server-only";
import { flowState, type FlowState } from "./flow";

// The browser's view of the event-day flow. In the site, activation leads
// straight to the team's Idea tab: the Codex step (a paired machine, /setup)
// isn't a gate here. flowState() itself, /api/v1/me/flow and everything Codex
// reads keep the Codex step unchanged.

export async function uiFlowState(memberId: number): Promise<FlowState> {
  const s = await flowState(memberId);
  return s.stage === "codex" && s.teamSlug ? { stage: "hub", next: `/t/${s.teamSlug}/idea`, teamSlug: s.teamSlug } : s;
}
