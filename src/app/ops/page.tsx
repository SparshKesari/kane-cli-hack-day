import type { Metadata } from "next";
import Link from "next/link";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import DemoDataChip from "@/components/ui/DemoDataChip";
import FreshnessStamp from "@/components/ui/FreshnessStamp";
import StatusPill from "@/components/ui/StatusPill";
import { challenge } from "@/data/hackday";
import { formatEventTime, getEvent, msUntil } from "@/lib/event";
import { PROGRESS_ITEMS, shippedMinimum } from "@/lib/progress";
import { isRegistrationOpen, listTeams } from "@/lib/teams";
import { INTEGRATIONS, getEventValues, getOverview } from "@/server/ops";
import { OpsPage, SectionLabel, StaffGate, Stats, fmtTime } from "./_kit/shell";
import { AdminBar, TeamsTable, type TeamRow } from "./parts";
import { listTeamPhotoStats } from "./queries";

export const metadata: Metadata = { title: "Overview", robots: { index: false } };

// Ops overview (T-OPS-01): the numbers an organizer needs at a glance, what's
// broken right now, and the existing every-team table (T-OPS-07). Unknown
// numbers (a table not migrated yet) show "—", never 0.

const SHORTCUTS = [
  ["/ops/roster/import", "Import Luma CSV", "Diff before commit"],
  ["/ops/announcements", "Announce", "TV + hub"],
  ["/ops/recovery", "Recovery", "Incidents, paper intake"],
  ["/ops/integrations", "Integrations", "Health, pause, outbox"],
  ["/ops/settings", "Settings", "Deadlines, phase, flags, staff"],
  ["/ops/audit", "Audit log", "Who did what"],
  ["/ops/override", "Override", "Signed, witnessed"],
] as const;

export default function OpsOverviewPage() {
  return (
    <OpsPage eyebrow="Overview" dim="Every team," bright="One view.">
      <StaffGate roles={["organizer"]} next="/ops">
        {async () => {
          const [ev, ov, values, teams, open, photoStats] = await Promise.all([getEvent(), getOverview(), getEventValues(), listTeams(), isRegistrationOpen(), listTeamPhotoStats()]);
          const photosByTeam = new Map(photoStats.map((p) => [p.team_id, p]));
          const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ev.timezone });
          const rows: TeamRow[] = teams.map((t) => {
            const done = new Set(t.done_items);
            const p = photosByTeam.get(t.id);
            return {
              slug: t.slug,
              name: t.name,
              track: t.track,
              isSolo: t.is_solo,
              members: t.member_names,
              done: done.size,
              total: PROGRESS_ITEMS.length,
              shipped: shippedMinimum(done),
              lastActivity: t.last_activity ? clock.format(t.last_activity) : "—",
              photos: {
                team: p?.has_photo ?? false,
                consented: p?.consented ?? 0,
                declined: p?.declined ?? 0,
                selfies: p?.selfies ?? 0,
                socials: p?.socials ?? 0,
                members: p?.member_count ?? t.member_count,
                gallery: p?.gallery ?? 0,
              },
            };
          });
          const toLock = msUntil(ev, "submission");
          const lockIn = toLock > 0 ? `${Math.floor(toLock / 3_600_000)}h ${Math.floor((toLock % 3_600_000) / 60_000)}m` : "locked";
          return (
            <div className="space-y-12">
              {ev.isDemo && <DemoDataChip />}
              {values.deploy_freeze && (
                <DegradedServiceAlert state="delayed" system="Deploy freeze" manualRoute="/ops/settings#freeze" manualLabel="Settings">
                  Nonessential deploys are frozen{values.deploy_freeze_reason ? `: ${values.deploy_freeze_reason}` : ""}. Use Vercel Instant Rollback if a deploy misbehaves.
                </DegradedServiceAlert>
              )}
              {ov.openIncidents.map((i) => (
                <DegradedServiceAlert key={i.code} state={i.severity === "sev1" ? "down" : "degraded"} system={`${i.code} · ${i.subsystem}`} manualRoute="/ops/recovery#incidents" manualLabel="Recovery">
                  {i.description}
                </DegradedServiceAlert>
              ))}
              {ov.problems.map((p) => (
                <DegradedServiceAlert key={p.system} state={p.status === "down" ? "down" : "degraded"} system={INTEGRATIONS[p.system]?.label ?? p.system} manualRoute="/ops/integrations" manualLabel="Integrations">
                  {p.paused ? "Paused. " : ""}
                  {p.detail ?? ""}
                </DegradedServiceAlert>
              ))}

              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-3 font-plex text-sm text-lightgray">
                  <StatusPill tone="accent">{ev.phase}</StatusPill>
                  {ev.phaseSource === "override" && <StatusPill tone="pending">Phase forced</StatusPill>}
                  <span>
                    Server time <span className="text-bright">{formatEventTime(ev.now, ev)}</span> · submissions lock{" "}
                    <span className="text-bright">{formatEventTime(ev.submissionLocksAt, ev)}</span> ({lockIn})
                  </span>
                </p>
                <Stats
                  items={[
                    { label: "Registered", value: ov.members, hint: `${ov.teams} teams · ${ov.solo} solo` },
                    { label: "On roster", value: ov.rosterGuests || null, hint: ov.rosterGuests ? `${ov.admitted} admitted` : "import Luma CSV", href: "/ops/roster" },
                    { label: "Reconcile", value: ov.needsReconciliation, hint: "no roster match", href: "/ops/roster?filter=needs_reconciliation" },
                    { label: "Help open", value: ov.helpOpen, hint: ov.helpOldestMin != null ? `oldest ${ov.helpOldestMin}m` : undefined, href: "/ops/help" },
                    { label: "Receipts", value: ov.receipts, hint: ov.manualReceipts ? `${ov.manualReceipts} manual` : undefined, href: "/ops/submissions" },
                  ]}
                />
                <FreshnessStamp asOf={ov.asOf} source="database" />
                <p className="font-plex text-xs text-lightgray">
                  Last announcement:{" "}
                  {ov.lastAnnouncement ? (
                    <>
                      <span className="text-bright">{ov.lastAnnouncement.title}</span> · {fmtTime(ov.lastAnnouncement.send_at)} · {ov.lastAnnouncement.visibility}
                    </>
                  ) : (
                    "none yet"
                  )}
                </p>
              </div>

              <section>
                <SectionLabel>Shortcuts</SectionLabel>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {SHORTCUTS.map(([href, title, sub]) => (
                    <li key={href}>
                      <Link href={href} className="brackets block min-h-11 border border-hairline bg-surface p-4 transition-colors hover:border-lime">
                        <span className="block font-plex text-sm text-bright">{title} →</span>
                        <span className="mt-1 block font-plex text-xs text-lightgray">{sub}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-6">
                <SectionLabel aside={`${rows.length} teams`}>Teams</SectionLabel>
                <AdminBar registrationOpen={open} />
                <TeamsTable rows={rows} tracks={challenge.tracks} />
              </section>
            </div>
          );
        }}
      </StaffGate>
    </OpsPage>
  );
}
