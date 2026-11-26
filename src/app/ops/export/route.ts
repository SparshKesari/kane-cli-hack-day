import { PROGRESS_ITEMS, shippedMinimum } from "@/lib/progress";
import { isAdmin } from "@/lib/session";
import { listFinalAttendees } from "../final-tracker/data";
import { listAllMembers, listAllProgress, listTeams } from "@/lib/teams";
import { listMemberSocials, listTeamPhotoStats } from "../queries";

// CSV downloads for judges and organizers: one row per team, or per member.

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote everything; neutralise leading formula characters for spreadsheet apps.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n");

export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const param = new URL(request.url).searchParams.get("type");
  const type = param === "members" || param === "final" ? param : "teams";

  let csv: string;
  if (type === "final") {
    csv = await finalAttendeesCsv();
  } else if (type === "members") {
    const [members, socials] = await Promise.all([listAllMembers(), listMemberSocials()]);
    const byMember = new Map(socials.map((s) => [s.id, s]));
    csv = toCsv([
      ["team", "slug", "track", "name", "email", "consent_social", "linkedin", "x_handle", "has_photo"],
      ...members.map((m) => {
        const s = byMember.get(m.id);
        const consent = s?.consent_social == null ? "not asked" : s.consent_social ? "yes" : "no";
        return [m.team_name, m.team_slug, m.track, m.name, m.email, consent, s?.linkedin, s?.x_handle, s?.has_photo ? "yes" : "no"];
      }),
    ]);
  } else {
    const [teams, progress, photoStats] = await Promise.all([listTeams(), listAllProgress(), listTeamPhotoStats()]);
    const photos = new Map(photoStats.map((p) => [p.team_id, p]));
    const values = new Map(progress.map((p) => [`${p.team_id}:${p.item}`, p]));
    csv = toCsv([
      ["team", "slug", "solo", "track", "idea", "members", "done", "shipped", "consented", "has_photo", ...PROGRESS_ITEMS.map((i) => i.label)],
      ...teams.map((t) => {
        const done = new Set(t.done_items);
        return [
          t.name,
          t.slug,
          t.is_solo ? "yes" : "no",
          t.track,
          t.idea,
          t.member_names.join("; "),
          `${done.size}/${PROGRESS_ITEMS.length}`,
          shippedMinimum(done) ? "yes" : "no",
          `${photos.get(t.id)?.consented ?? 0}/${t.member_count}`,
          photos.get(t.id)?.has_photo ? "yes" : "no",
          ...PROGRESS_ITEMS.map((i) => {
            const p = values.get(`${t.id}:${i.id}`);
            return p ? `${p.done ? "[x] " : "[ ] "}${p.value}` : "";
          }),
        ];
      }),
    ]);
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hackday-${type}.csv"`,
      "cache-control": "no-store",
    },
  });
}

async function finalAttendeesCsv() {
  const rows = await listFinalAttendees();
  return toCsv([
    [
      "name", "email", "p_code", "github", "checked_in_at", "activated_at",
      "team", "team_slug", "track", "submission_status", "receipt", "finalized_at",
      "project_name", "one_line_pitch", "project_description", "repo_url", "demo_url", "video_url", "deck_url", "showcase_url", "ship_page", "ship_page_state",
    ],
    ...rows.map((r) => [
      r.name, r.email, r.public_code, r.github_handle, iso(r.checked_in_at), iso(r.activated_at),
      r.team_name, r.team_slug, r.track, r.status, r.receipt_code, iso(r.finalized_at),
      r.project_name, r.one_line_pitch, r.project_description, r.repo_url, r.demo_url, r.video_url, r.deck_url, r.showcase_url, r.ship_page, r.showcase_state ?? "",
    ]),
  ]);
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : "");
