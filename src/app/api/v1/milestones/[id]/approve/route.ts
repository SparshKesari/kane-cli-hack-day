import { AppError, envelopeResponse } from "@/server/core";
import { idParam, readMutation } from "@/server/kane-http";
import { approveMilestone, callerMember, resolveCaller } from "@/server/kane";

// POST /api/v1/milestones/{id}/approve { decision?: "approve" | "withdraw" }
// A teammate approves (or withdraws) a milestone's requested visibility. Same
// service as PATCH /api/v1/projects/{id}/milestones. Approval is a person's
// decision while signed in, never a token's.

export async function POST(req: Request, ctx: RouteContext<"/api/v1/milestones/[id]/approve">) {
  return envelopeResponse(async () => {
    const caller = await resolveCaller(req);
    if (caller.kind !== "member") throw new AppError("FORBIDDEN", { userMessage: "Approve milestones from the Proof tab while signed in." });
    const id = idParam((await ctx.params).id);
    const { payload } = await readMutation(req);
    const decision = payload.decision === "withdraw" ? "withdraw" : "approve";
    const r = await approveMilestone(callerMember(caller)!, id, decision);
    return { message: `Milestone ${r.id} ${r.status}.`, data: r };
  });
}
