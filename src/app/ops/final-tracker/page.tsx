import type { Metadata } from "next";
import { OpsPage, Panel, SectionLabel, StaffGate, Stats, fmtTime } from "../_kit/shell";
import { listFinalAttendees } from "./data";

export const metadata: Metadata = { title: "Final tracker", robots: { index: false } };

// Everyone who came in and activated, and what their team submitted. The CSV is the
// same list (/ops/export?type=final).

export default function FinalTrackerPage() {
  return (
    <OpsPage
      eyebrow="Final tracker"
      dim="Who came in, activated,"
      bright="and what they shipped."
      intro="One row per activated participant, with their team's submission. Ship links open on this site, so unpublished pages show as an organizer preview. Download the CSV for the full columns."
    >
      <StaffGate roles={["organizer"]} next="/ops/final-tracker">
        {async () => {
          const rows = await listFinalAttendees();
          const teams = new Set(rows.map((r) => r.team_slug).filter(Boolean));
          const finalized = rows.filter((r) => r.status === "finalized").length;
          const draft = rows.filter((r) => r.status === "draft").length;
          return (
            <div className="space-y-10">
              <Stats
                cols="sm:grid-cols-2 lg:grid-cols-5"
                items={[
                  { label: "Activated people", value: rows.length },
                  { label: "Teams", value: teams.size },
                  { label: "Finalized", value: finalized },
                  { label: "Draft only", value: draft },
                  { label: "Not submitted", value: rows.length - finalized - draft },
                ]}
              />
              <section>
                <SectionLabel id="list" aside={<a href="/ops/export?type=final" className="inline-flex min-h-11 items-center border border-lime px-3 font-plex text-xs text-lime hover:bg-lime-deep">Download final tracker (CSV)</a>}>
                  Final tracker
                </SectionLabel>
                <Panel>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left font-plex text-xs">
                      <thead className="text-lightgray">
                        <tr className="border-b border-hairline">
                          {["Name", "Email", "Team", "Activated", "Submission", "Project", "Links"].map((h) => (
                            <th key={h} className="px-3 py-2 font-normal">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${r.email}-${r.public_code}`} className="border-b border-hairline/60 align-top">
                            <td className="px-3 py-2 text-bright">{r.name}<div className="text-lightgray">{r.public_code}</div></td>
                            <td className="px-3 py-2 text-lightgray">{r.email}</td>
                            <td className="px-3 py-2 text-bright">{r.team_name ?? "—"}<div className="text-lightgray">{r.track}</div></td>
                            <td className="px-3 py-2 text-lightgray">{fmtTime(r.activated_at)}</td>
                            <td className={`px-3 py-2 ${r.status === "finalized" ? "text-lime" : r.status === "draft" ? "text-bright" : "text-red-300"}`}>{r.status}</td>
                            <td className="px-3 py-2 text-bright">{r.project_name || "—"}<div className="max-w-xs text-lightgray">{r.one_line_pitch}</div></td>
                            <td className="space-x-2 px-3 py-2">
                              {[["repo", r.repo_url], ["demo", r.demo_url], ["video", r.video_url], [r.ship_public ? "ship" : `ship (${r.showcase_state ?? "draft"}, preview)`, r.ship_path]]
                                .filter(([, u]) => u)
                                .map(([l, u]) => (
                                  <a key={l} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-lime">{l}</a>
                                ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </section>
            </div>
          );
        }}
      </StaffGate>
    </OpsPage>
  );
}
