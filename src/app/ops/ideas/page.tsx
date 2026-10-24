import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { getEvent } from "@/lib/event";
import { getStaff, hasRole } from "@/server/auth";
import { listIdeasForOps, type OpsIdeaRow } from "@/server/ideas";
import { AdminLogin } from "../parts";

export const metadata: Metadata = { title: "Ideas", robots: { index: false } };

// Every team's saved idea (what idea_save and the Idea tab store): title, app type,
// description and Kane plan, newest first. Teams with nothing saved are listed last.
// Organizer only; the descriptions are private to each team.

const label =
  "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

export default function IdeasPage() {
  return (
    <main className="[overflow-wrap:anywhere]">
      <PageHeader eyebrow="Ops" dim="Ideas," bright="Every team's." />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense
            fallback={
              <p className="font-plex text-sm text-lightgray">Loading…</p>
            }
          >
            <IdeasView />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function IdeasView() {
  const staff = await getStaff();
  if (!hasRole(staff, "organizer")) return <AdminLogin next="/ops/ideas" />;

  const [rows, ev] = await Promise.all([listIdeasForOps(staff), getEvent()]);
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ev.timezone,
    timeZoneName: "short",
  });
  const saved = rows.filter((r) => r.saved);
  const missing = rows.filter((r) => !r.saved);

  return (
    <div className="space-y-10">
      <p className="font-plex text-sm text-lightgray">
        <span className="text-bright">{saved.length}</span>{" "}
        {saved.length === 1 ? "team has" : "teams have"} saved an idea ·{" "}
        <span className="text-bright">{missing.length}</span>{" "}
        {missing.length === 1 ? "hasn't" : "haven't"} yet. Descriptions are
        private to each team.
      </p>

      <ul className="space-y-4">
        {saved.map((r) => (
          <IdeaCard
            key={r.team_id}
            row={r}
            updated={r.updated_at ? fmt.format(r.updated_at) : null}
          />
        ))}
      </ul>

      {missing.length > 0 && (
        <section className="border-t border-dashed border-hairline pt-6">
          <p className={`${label} mb-3`}>
            No idea saved yet · {missing.length}
          </p>
          <ul className="flex flex-wrap gap-2">
            {missing.map((r) => (
              <li key={r.team_id}>
                <Link
                  href={`/ops/t/${r.team_slug}`}
                  className="inline-flex min-h-9 items-center border border-hairline px-3 font-plex text-sm text-bright hover:border-lime"
                >
                  {r.team_name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function IdeaCard({
  row: r,
  updated,
}: {
  row: OpsIdeaRow;
  updated: string | null;
}) {
  return (
    <li className="border border-hairline p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl text-bright">
          {r.title || "Untitled"}
        </h2>
        <p className="font-plex text-xs text-lightgray">
          {[
            r.app_type,
            r.status,
            r.revision ? `rev ${r.revision}` : null,
            updated ? `updated ${updated}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <p className="mt-1 font-plex text-sm">
        <Link
          href={`/ops/t/${r.team_slug}`}
          className="text-lime hover:underline"
        >
          {r.team_name}
        </Link>
      </p>
      {r.private_description && (
        <p className="mt-3 max-w-3xl whitespace-pre-line font-plex text-sm leading-relaxed text-bright">
          {r.private_description}
        </p>
      )}
      {r.kane_plan ? (
        <div className="mt-4">
          <p className={label}>Kane plan</p>
          <p className="mt-1 max-w-3xl whitespace-pre-line font-plex text-sm leading-relaxed text-lightgray">
            {r.kane_plan}
          </p>
        </div>
      ) : (
        <p className="mt-4 font-plex text-xs text-warning">No Kane plan yet.</p>
      )}
      {r.extra_info && (
        <div className="mt-4">
          <p className={label}>Extra</p>
          <p className="mt-1 max-w-3xl whitespace-pre-line font-plex text-sm text-lightgray">
            {r.extra_info}
          </p>
        </div>
      )}
    </li>
  );
}
