import { query } from "@/lib/db";
import { PROGRESS_ITEMS } from "@/lib/progress";
import { getStaff, hasRole, staffActor } from "@/server/auth";
import { writeAudit } from "@/server/core";
import { normalizeDraft } from "@/server/submission";

// CSV of every team's submission for organizers: one row per team, whatever its
// state (no submission yet, draft, unpublished, withdrawn), with the roster, idea,
// project record, progress checklist and every field from the submission form.

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n");
const list = (a: readonly unknown[] | null | undefined) => (a ?? []).join("\n");
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : "");

type Row = {
  team_name: string;
  team_slug: string;
  track: string | null;
  idea: string | null;
  is_solo: boolean;
  members: { name: string; email: string }[];
  idea_title: string | null;
  idea_status: string | null;
  idea_qualification: string | null;
  idea_description: string | null;
  idea_public_summary: string | null;
  idea_app_type: string | null;
  idea_kane_plan: string | null;
  idea_extra_info: string | null;
  project_slug: string | null;
  project_state: string | null;
  project_summary: string | null;
  project_repo_url: string | null;
  project_live_url: string | null;
  project_run_command: string | null;
  progress: Record<string, { value: string; done: boolean }> | null;
  showcase_state: string | null;
  status: string | null;
  receipt_code: string | null;
  source: string | null;
  finalized_at: Date | null;
  received_at: Date | null;
  updated_at: Date | null;
  draft: unknown;
};

export async function GET() {
  const staff = await getStaff();
  if (!hasRole(staff, "organizer")) return new Response("Unauthorized", { status: 401 });

  const rows = await query<Row>(
    `select t.name as team_name, t.slug as team_slug, t.track, t.idea, t.is_solo,
            (select coalesce(json_agg(json_build_object('name', m.name, 'email', m.email) order by m.id), '[]') from members m where m.team_id = t.id) as members,
            i.title as idea_title, i.status as idea_status, i.qualification as idea_qualification, i.private_description as idea_description,
            i.public_summary as idea_public_summary, i.app_type as idea_app_type, i.kane_plan as idea_kane_plan, i.extra_info as idea_extra_info,
            p.slug as project_slug, p.state as project_state, p.summary as project_summary, p.repo_url as project_repo_url,
            p.live_url as project_live_url, p.run_command as project_run_command, p.showcase_state,
            (select json_object_agg(g.item, json_build_object('value', g.value, 'done', g.done)) from progress g where g.team_id = t.id) as progress, s.status, s.receipt_code, s.source, s.finalized_at, s.received_at, s.updated_at, s.draft
       from teams t
       left join ideas i on i.team_id = t.id
       left join projects p on p.team_id = t.id
       left join lateral (
         select * from submissions x where x.project_id = p.id order by (x.status <> 'withdrawn') desc, x.id desc limit 1
       ) s on true
      order by s.finalized_at desc nulls last, t.name`,
  );

  const csv = toCsv([
    [
      "team", "slug", "track", "solo", "idea", "member_count", "members", "member_emails",
      "status", "receipt", "source", "finalized_at", "received_at", "last_updated", "showcase_state",
      "idea_title", "idea_status", "idea_qualification", "idea_description", "idea_public_summary", "idea_app_type", "idea_kane_plan", "idea_extra_info",
      "project_slug", "project_state", "project_summary", "project_repo_url", "project_live_url", "project_run_command",
      "project_name", "project_type", "one_line_pitch", "project_description", "problem", "what_we_built", "how_it_works",
      "harness_summary", "harness_stages", "kane_components", "kane_run_ids",
      "repo_url", "commit_sha", "demo_url", "run_command", "video_url", "showcase_url", "deck_url", "devpost_url", "hn_url",
      "linkedin_posts", "x_posts", "blog_links", "social_links", "evidence_refs", "screenshots", "limitations", "impact",
      ...PROGRESS_ITEMS.map((i) => `progress: ${i.label}`),
    ],
    ...rows.map((r) => {
      const d = r.status ? normalizeDraft(r.draft) : null;
      return [
        r.team_name, r.team_slug, r.track, r.is_solo ? "yes" : "no", r.idea, r.members.length,
        list(r.members.map((m) => m.name)), list(r.members.map((m) => m.email)),
        r.status ?? "not started", r.receipt_code, r.source, iso(r.finalized_at), iso(r.received_at), iso(r.updated_at), r.showcase_state,
        r.idea_title, r.idea_status, r.idea_qualification, r.idea_description, r.idea_public_summary, r.idea_app_type, r.idea_kane_plan, r.idea_extra_info,
        r.project_slug, r.project_state, r.project_summary, r.project_repo_url, r.project_live_url, r.project_run_command,
        d?.project_name, d?.project_type, d?.one_line_pitch, d?.project_description, d?.problem, d?.what_we_built, list(d?.how_it_works),
        d?.harness_summary, list(d?.harness_stages), list(d?.kane_components), list(d?.kane_run_ids),
        d?.repo_url, d?.commit_sha, d?.demo_url, d?.run_command, d?.video_url, d?.showcase_url, d?.deck_url, d?.devpost_url, d?.hn_url,
        list(d?.linkedin_posts), list(d?.x_posts), list(d?.blog_links), list(d?.social_links), list(d?.evidence_refs),
        list(d?.screenshots.map((s) => s.path)), list(d?.limitations),
        list(d?.impact.map((i) => [i.claim, i.measure != null ? `${i.measure}${i.unit ? ` ${i.unit}` : ""}` : "", i.baseline != null ? `baseline ${i.baseline}` : "", i.source ?? ""].filter(Boolean).join(" · "))),
        ...PROGRESS_ITEMS.map((i) => {
          const g = r.progress?.[i.id];
          return g ? `${g.done ? "[x] " : "[ ] "}${g.value}` : "";
        }),
      ];
    }),
  ]);

  await writeAudit(staffActor(staff!), { action: "submission.export", resourceType: "submission", resourceId: "all" }).catch(() => {});
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="submissions.csv"`,
      "cache-control": "no-store",
    },
  });
}
