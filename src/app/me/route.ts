import { getMemberSession } from "@/lib/session";
import { uiFlowState } from "@/server/flow-ui";

// "Resume": wherever this person is in the event-day flow (profile → team →
// activate → Codex → hub). Signed out → start at /register.
export async function GET(request: Request) {
  const s = await getMemberSession();
  const next = s?.personal ? (await uiFlowState(s.memberId)).next : "/register";
  return Response.redirect(new URL(next, request.url), 307);
}
