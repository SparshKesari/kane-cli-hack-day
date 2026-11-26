import type { Metadata } from "next";
import { Suspense } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { getEvent } from "@/lib/event";
import { getStaff, hasRole } from "@/server/auth";
import { PROJECT_TYPES, PROJECT_TYPE_LABEL } from "@/server/showcase";
import { listSubmissionsForOps } from "@/server/submission";
import { AdminLogin } from "../parts";
import { LockAll, ManualReceiptForm, SubmissionsTable, type OpsRow } from "./parts";

export const metadata: Metadata = { title: "Submissions", robots: { index: false } };

// Every team's official submission: status, receipt, server times, showcase
// state, moderation, slug renames, withdrawals, and the manual (offline)
// receipt intake from fallback/05.

export default function SubmissionsPage() {
  return (
    <main>
      <PageHeader eyebrow="Ops" dim="Submissions," bright="On the record." />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>
            <SubmissionsView />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

const label = "mb-3 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

/** "2026-10-24T17:58" for a datetime-local default, in the event's zone. */
function localInput(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

async function SubmissionsView() {
  const staff = await getStaff();
  if (!hasRole(staff, "organizer")) return <AdminLogin next="/ops/submissions" />;

  const [rows, ev] = await Promise.all([listSubmissionsForOps(staff!), getEvent()]);
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: ev.timezone, timeZoneName: "short" });
  const locked = ev.now.getTime() >= ev.submissionLocksAt.getTime();
  const final = rows.filter((r) => r.status === "finalized" || r.status === "locked").length;
  const manual = rows.filter((r) => r.source === "manual_offline").length;
  const drafts = rows.filter((r) => r.status && !["finalized", "locked", "withdrawn"].includes(r.status)).length;

  const data: OpsRow[] = rows.map((r) => ({
    teamSlug: r.team_slug,
    teamName: r.team_name,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    projectType: r.project_type,
    showcase: r.showcase_state,
    status: r.status,
    receipt: r.receipt_code,
    source: r.source,
    finalizedAt: r.finalized_at ? fmt.format(r.finalized_at) : null,
    receivedAt: r.received_at ? fmt.format(r.received_at) : null,
    commit: r.commit_sha,
    preflightOk: r.preflight_ok,
  }));

  return (
    <div className="space-y-14">
      <div className="grid gap-px border border-hairline bg-hairline sm:grid-cols-4">
        {[
          ["Finalized", `${final}/${rows.length}`],
          ["Open drafts", String(drafts)],
          ["Manual receipts", String(manual)],
          ["Lock (server)", fmt.format(ev.submissionLocksAt)],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink p-4">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{k}</p>
            <p className="mt-2 font-dots text-3xl font-black text-bright">{v}</p>
          </div>
        ))}
      </div>
      <p className="font-plex text-xs text-lightgray">Server time {fmt.format(ev.now)}{ev.fallback ? " · event config unavailable, showing defaults" : ""}.</p>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">All teams</p>
          <a href="/ops/submissions/export" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
            Export all submissions (CSV)
          </a>
        </div>
        <SubmissionsTable rows={data} />
      </div>

      <div>
        <p className={label}>After the deadline</p>
        <LockAll disabled={!locked} />
      </div>

      <div id="manual" className="max-w-3xl">
        <p className={label}>Manual receipt (offline backup)</p>
        <ManualReceiptForm
          teams={rows.map((r) => ({ slug: r.team_slug, name: r.team_name }))}
          types={PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABEL[t] }))}
          nowLocal={localInput(ev.now, ev.timezone)}
          officer={`${staff!.name} (${staff!.role})`}
        />
      </div>
    </div>
  );
}
