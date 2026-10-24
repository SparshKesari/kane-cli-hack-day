import { ZodError } from "zod";
import { bearerOk, parseRosterAdd } from "@/lib/codex-coupon";
import { addRosterPeople } from "@/server/roster";

// POST /api/import/roster: organizers add people to the participant list (Codex coupon eligibility).
// Authorization: Bearer <ROSTER_API_TOKEN>. Body { email, name? } or { people: [{ email, name? }, …] }
// (up to 500). Re-adding someone changes nothing; someone revoked stays revoked.
//   curl -X POST https://www.kaneclihack.sh/api/import/roster -H "Authorization: Bearer $ROSTER_API_TOKEN" \
//        -H 'content-type: application/json' -d '{"email":"ann@example.com","name":"Ann Lee"}'
export async function POST(req: Request) {
  if (!bearerOk(req.headers.get("authorization"), process.env.ROSTER_API_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let people;
  try {
    people = parseRosterAdd(await req.json().catch(() => null));
  } catch (err) {
    const issues = err instanceof ZodError ? err.issues.slice(0, 10).map((i) => `${i.path.join(".") || "body"}: ${i.message}`) : [];
    return Response.json({ error: "Send { email, name? } or { people: [{ email, name? }] } (up to 500).", issues }, { status: 400 });
  }
  const data = await addRosterPeople(people);
  return Response.json({ data });
}
