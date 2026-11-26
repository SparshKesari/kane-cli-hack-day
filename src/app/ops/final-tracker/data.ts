import "server-only";
import { query } from "@/lib/db";
import { normalizeDraft } from "@/server/submission";

// The final tracker: everyone who finished activation (the checklist, done on site),
// with the project their team submitted (latest non-withdrawn submission).
// Shared by /ops/final-tracker and the CSV at /ops/export?type=final.

type Raw = {
  name: string;
  email: string;
  public_code: string | null;
  github_handle: string | null;
  checked_in_at: Date | null;
  activated_at: Date;
  team_name: string | null;
  team_slug: string | null;
  track: string | null;
  showcase_state: string | null;
  status: string | null;
  receipt_code: string | null;
  finalized_at: Date | null;
  draft: unknown;
};

export type FinalAttendee = Omit<Raw, "draft" | "status"> & {
  status: string;
  project_name: string;
  one_line_pitch: string;
  project_description: string;
  repo_url: string;
  demo_url: string;
  video_url: string;
  deck_url: string;
  showcase_url: string;
  ship_page: string;
  /** Same-site path, so an organizer's session can preview unpublished pages. */
  ship_path: string;
  ship_public: boolean;
};

export async function listFinalAttendees(): Promise<FinalAttendee[]> {
  const rows = await query<Raw>(
    `select coalesce(m.display_name, m.name) as name, m.email, m.public_code, m.github_handle,
            coalesce(m.checked_in_at, g.checked_in_at) as checked_in_at, m.activated_at,
            t.name as team_name, t.slug as team_slug, t.track, p.showcase_state,
            s.status, s.receipt_code, s.finalized_at, s.draft
       from members m
       left join roster_guests g on g.id = m.guest_id
       left join teams t on t.id = m.team_id
       left join projects p on p.team_id = t.id
       left join lateral (
         select * from submissions x where x.project_id = p.id and x.status <> 'withdrawn' order by x.id desc limit 1
       ) s on true
      where m.deleted_at is null and m.role = 'participant' and m.activated_at is not null
      order by t.name nulls last, m.activated_at`,
  );
  return rows.map(({ draft, status, ...r }) => {
    const d = status ? normalizeDraft(draft) : null;
    return {
      ...r,
      status: status ?? "not submitted",
      project_name: d?.project_name ?? "",
      one_line_pitch: d?.one_line_pitch ?? "",
      project_description: d?.project_description ?? "",
      repo_url: d?.repo_url ?? "",
      demo_url: d?.demo_url ?? "",
      video_url: d?.video_url ?? "",
      deck_url: d?.deck_url ?? "",
      showcase_url: d?.showcase_url ?? "",
      ship_page: r.team_slug && status ? `https://www.kaneclihack.sh/ship/${r.team_slug}` : "",
      ship_path: r.team_slug && status ? `/ship/${r.team_slug}` : "",
      ship_public: r.showcase_state === "public" || r.showcase_state === "unlisted",
    };
  });
}
