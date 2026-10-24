import { isRegistrationOpen } from "@/lib/teams";
import { activationEnabled } from "@/lib/testmu-provision";
import { getMemberById, getPersonalMember } from "@/server/auth";
import { AppError, envelopeResponse, runAction, sha256, siteUrl } from "@/server/core";
import { flowState, setTeamChoice, submitProfile } from "@/server/flow";
import { clientKey, enforceRateLimit } from "@/server/ratelimit";
import { issueBearerToken } from "@/server/pairing";
import { activateTestmu } from "@/server/testmu";
import { readBody } from "../../teams/body";

// POST /api/v1/auth/register: save the profile and activate TestMu AI; returns the access key once.
// No TestMu key needed: this is where it comes from.
//   { name, email (the Luma one), linkedin, x?, github?, password (8+), looking?: "yes",
//     proof_password? | proof_code? (only when the email already has an account) }
// The same profile as /register. Saves it, then activates the person on TestMu AI
// with it: TestMu answers with their username + access key, returned here ONCE as
// data.testmu. Send them as X-TestMu-Username / X-TestMu-Access-Key on every call
// after. The key isn't stored (only a fingerprint), so it can't be fetched again.
// 409 needs_proof: the email has an account; resend with proof_password or proof_code.
// client: "kanehack" → data.token, a bearer token for this machine (the password just proved
// who they are), so `kanehack register` needs no browser pairing.

export async function POST(req: Request) {
  return envelopeResponse(async () => {
    // Everyone at the venue shares one public IP (kanehack register runs on their laptops), so the
    // per-IP cap is roomy; guessing an existing account's proof is capped per email, like /register.
    await enforceRateLimit(`api-register:${await clientKey(req)}`, { limit: 200, windowSec: 300 });
    const viewer = await getPersonalMember();
    if (!viewer && !(await isRegistrationOpen())) throw new AppError("DEADLINE_PASSED", { userMessage: "Registration is closed. Ask at the help desk." });
    const body = await readBody(req);
    if (typeof body.email === "string") await enforceRateLimit(`api-register-email:${sha256(body.email.trim().toLowerCase())}`, { limit: 10, windowSec: 900 });
    const r = await submitProfile({ ...body, looking: body.looking === true || body.looking === "yes" ? "yes" : undefined }, viewer);
    if (r.kind === "needs_proof") {
      throw new AppError("CONFLICT", { userMessage: "That email already has an account. Send proof_password (its password) or proof_code (a one-time code from the desk)." });
    }
    const member = await getMemberById(r.memberId);
    if (member) await setTeamChoice(member, r.looking, { fromProfile: true });
    const issued = body.client === "kanehack" ? await issueBearerToken(r.memberId, typeof body.label === "string" ? body.label : null, "register") : null;
    const token = issued ? { token: issued.token, token_id: issued.token_id, expires_at: issued.expires_at } : {};
    const activation = activationEnabled() ? await runAction(() => activateTestmu(r.memberId)) : null;
    const next = (await flowState(r.memberId)).next;
    if (activation && !activation.ok) {
      return {
        status: "needs_action",
        message: `Profile saved, but TestMu AI activation failed: ${activation.error.message}`,
        data: { member_id: r.memberId, created: r.created, testmu: null, next: siteUrl(next), ...token },
        actions: [{ id: "retry_activation", label: "Retry TestMu AI activation", requires_human_confirmation: false, href: siteUrl("/api/v1/auth/testmu/start?next=/register") }],
        warnings: [activation.error.code],
      };
    }
    const t = activation?.ok ? activation.data : null;
    return {
      message: t ? `Profile saved and TestMu AI activated as ${t.username}. Save the access key now: it is shown only once.` : "Profile saved.",
      data: { member_id: r.memberId, created: r.created, testmu: t ? { username: t.username, access_key: t.access_key } : null, next: siteUrl(next), ...token },
      fallbackText: t ? `TestMu AI username: ${t.username}\nAccess key: ${t.access_key}\nSend both as X-TestMu-Username / X-TestMu-Access-Key from now on.` : "Profile saved.",
      warnings: t ? [] : ["TestMu AI activation isn't configured on this deployment yet."],
    };
  });
}
