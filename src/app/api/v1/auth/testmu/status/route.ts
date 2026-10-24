import { keyRequired } from "@/lib/testmu-gate";
import { envelopeResponse } from "@/server/core";
import { getMember } from "@/server/auth";
import { getTestmuIdentity } from "@/server/testmu";

// GET /api/v1/auth/testmu/status
// Whether this browser or CLI call carries a verified TestMu AI identity, which
// registration it maps to, and whether the gate is switched on. Never returns the key.

export async function GET() {
  return envelopeResponse(async () => {
    const [id, member] = await Promise.all([getTestmuIdentity(), getMember()]);
    const required = keyRequired();
    return {
      status: id ? "ok" : required ? "needs_action" : "ok",
      message: id ? `Connected to TestMu AI as ${id.u}.` : required ? "Not connected to TestMu AI." : "Not connected to TestMu AI (not required right now).",
      data: {
        key_required: required,
        connected: !!id,
        testmu_username: id?.u ?? null,
        member: member ? { id: member.id, name: member.name, team_id: member.team_id } : null,
        expires_at: id ? new Date(id.exp).toISOString() : null,
      },
      actions: id ? [] : [{ id: "connect_testmu", label: "Connect TestMu AI", requires_human_confirmation: false, href: "/api/v1/auth/testmu/start" }],
    };
  });
}
