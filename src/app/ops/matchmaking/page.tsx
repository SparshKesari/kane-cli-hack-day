import type { Metadata } from "next";
import Link from "next/link";
import { challenge, trackLabel } from "@/data/hackday";
import { listOpenTeams, listPoolForOps } from "@/server/flow";
import ActionForm, { SelectField, TextField } from "../_kit/ActionForm";
import { OpsPage, Panel, SectionLabel, StaffGate, Stats, fmtTime } from "../_kit/shell";
import { formTeamAction } from "./actions";

export const metadata: Metadata = { title: "Matchmaking", robots: { index: false } };

// The matchmaking cut-off: everyone still in the pool, with skills. Pick 2–4
// people, name the team, and form it (the first ticked, top to bottom, is captain).
// They leave the pool and land on the activation checklist.

export default function OpsMatchmakingPage() {
  return (
    <OpsPage eyebrow="Matchmaking" dim="Still looking?" bright="Form the team." intro="Everyone still in the matchmaking pool. Tick 2 to 4 people (the first ticked, top to bottom, becomes captain), name the team and form it. Every team formed here is audited.">
      <StaffGate roles={["organizer"]} next="/ops/matchmaking">
        {async () => {
          const [pool, teams] = await Promise.all([listPoolForOps(), listOpenTeams(0)]);
          return (
            <div className="space-y-12">
              <Stats
                cols="sm:grid-cols-3"
                items={[
                  { label: "In the pool", value: pool.length },
                  { label: "Teams with open seats", value: teams.length },
                  { label: "Open seats", value: teams.reduce((n, t) => n + t.open_seats, 0) },
                ]}
              />
              <Panel title="Form a team from the pool">
                {pool.length < 2 ? (
                  <p className="font-plex text-sm text-lightgray">{pool.length === 1 ? "One person is in the pool. Add them to a team with open seats from Override, or wait for more." : "Nobody is in the pool."}</p>
                ) : (
                  <ActionForm action={formTeamAction} submit="Form team" pending="Forming…" confirm="Form this team? The people ticked leave the pool and join it now.">
                    <fieldset>
                      <legend className="sr-only">People in the pool</legend>
                      <ul className="border-t border-dashed border-hairline">
                        {pool.map((p) => (
                          <li key={p.member_id} className="border-b border-dashed border-hairline">
                            <label className="flex min-h-11 cursor-pointer flex-wrap items-start gap-3 py-2.5 font-plex text-sm">
                              <input type="checkbox" name="member_ids" value={p.member_id} className="mt-1 h-5 w-5 accent-[var(--lime)]" />
                              <span className="min-w-0 flex-1">
                                <span className="text-bright">{p.name}</span>
                                <span className="text-xs text-lightgray">
                                  {" "}
                                  · {p.public_code ?? "no P-code"} · {p.checked_in_at ? "checked in" : "not checked in"} · in pool since {fmtTime(p.since)}
                                </span>
                                <span className="mt-1 block text-xs text-lightgray">
                                  Skills: <span className="text-bright">{p.skills.join(", ") || "—"}</span>
                                  {p.interests.length > 0 && <> · Interests: {p.interests.join(", ")}</>}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField id="mm-name" name="name" label="Team name" required maxLength={60} />
                      <SelectField id="mm-track" name="track" label="Track" options={challenge.tracks.map((t) => ({ value: t, label: t }))} />
                    </div>
                    <TextField id="mm-reason" name="reason" label="Note" hint="optional · audited" maxLength={500} placeholder="e.g. Cut-off 11:30, matched on skills" />
                  </ActionForm>
                )}
              </Panel>
              <section>
                <SectionLabel>Teams with open seats</SectionLabel>
                {teams.length === 0 ? (
                  <p className="font-plex text-sm text-lightgray">None right now.</p>
                ) : (
                  <ul className="border-t border-dashed border-hairline">
                    {teams.map((t) => (
                      <li key={t.team_id} className="flex flex-wrap justify-between gap-3 border-b border-dashed border-hairline py-2.5 font-plex text-sm">
                        <Link href={`/ops/t/${t.slug}`} className="text-bright underline-offset-4 hover:text-lime hover:underline">
                          {t.name}
                        </Link>
                        <span className="text-xs text-lightgray">
                          {t.open_seats} open · {trackLabel(t.track)}
                          {t.seeking_skills.length ? ` · wants ${t.seeking_skills.join(", ")}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 font-plex text-xs text-lightgray">To put one person on an existing team, use Override with their P-code.</p>
              </section>
            </div>
          );
        }}
      </StaffGate>
    </OpsPage>
  );
}
