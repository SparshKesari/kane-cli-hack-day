"use client";

import { Label, inputCls } from "@/components/forms/fields";
import StatusPill from "@/components/ui/StatusPill";
import { FINAL_STATS, type FinalStats } from "@/components/live/final-stats";
import ActionForm, { TextField } from "../_kit/ActionForm";
import { finalStatsAction } from "./actions";

// Client bits of /ops/final-stats: the two-file import form and the numbers it found.

const fmt = (n: number) => n.toLocaleString("en-US");
const orgs = (n: number) => `${fmt(n)} ${n === 1 ? "org" : "orgs"}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" }).format(new Date(iso));

export function ImportForm() {
  return (
    <ActionForm
      action={finalStatsAction}
      submit="Check the files"
      pending="Matching participants…"
      render={(s) => (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 font-plex text-sm text-bright">
            <StatusPill tone="neutral">{s.receipt ? "Saved" : "Checked"}</StatusPill>
            {s.message}
            {s.receipt && <span className="text-xs text-lightgray">Receipt {s.receipt.id}</span>}
          </p>
          {Boolean(s.data) && <StatsTable stats={s.data as FinalStats} />}
        </div>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="fs-latest" hint="the usage page's /data/latest.json">
            latest.json
          </Label>
          <input id="fs-latest" name="latest" type="file" accept="application/json,.json" required className={`${inputCls} min-h-11`} />
        </div>
        <div>
          <Label htmlFor="fs-emails" hint="the usage page's /emails.json">
            emails.json
          </Label>
          <input id="fs-emails" name="emails" type="file" accept="application/json,.json" required className={`${inputCls} min-h-11`} />
        </div>
      </div>
      <label className="flex items-center gap-3 font-plex text-sm text-bright">
        <input type="checkbox" name="save" className="size-5 accent-lime" />
        Save as the final numbers (otherwise this only checks)
      </label>
      <TextField id="fs-reason" name="reason" label="Reason" hint="needed to save · audited" maxLength={300} placeholder="e.g. final numbers after submissions closed" />
    </ActionForm>
  );
}

/** Totals, how participants were matched, and each team's numbers. */
export function StatsTable({ stats }: { stats: FinalStats }) {
  const m = stats.matched;
  return (
    <div className="space-y-4">
      <dl className="grid gap-px border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6">
        {FINAL_STATS.map((s) => (
          <div key={s.key} className="bg-ink p-3">
            <dt className="font-pixel text-[10px] tracking-[0.2em] text-lightgray uppercase">{s.label}</dt>
            <dd className="mt-1 font-display text-2xl text-bright tabular-nums">{fmt(stats.totals[s.key])}</dd>
          </div>
        ))}
      </dl>
      <p className="font-plex text-xs text-lightgray">
        Usage data from {when(stats.window.from)} to {when(stats.window.to)}
        {stats.imported_at ? ` · saved ${when(stats.imported_at)}` : ""}. {orgs(m.orgs)} counted ({fmt(m.by_org_id)} from TestMu AI claims, {fmt(m.by_email)} by email) ·{" "}
        {fmt(m.participants_matched)} of {fmt(m.participants)} participants found · {orgs(m.shared_skipped)} shared with non-participants left out
        {m.team_conflicts ? ` · ${orgs(m.team_conflicts)} with people from more than one team (counted for the team with the most)` : ""}.
      </p>
      {stats.teams.length > 0 && (
        <div className="overflow-x-auto border border-hairline">
          <table className="w-full min-w-[640px] font-plex text-xs">
            <thead>
              <tr className="text-left text-lightgray">
                <th className="p-2 font-normal">Team</th>
                {FINAL_STATS.map((s) => (
                  <th key={s.key} className="p-2 text-right font-normal">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.teams.map((t) => (
                <tr key={t.slug} className="border-t border-hairline text-bright">
                  <td className="p-2">{t.name}</td>
                  {FINAL_STATS.map((s) => (
                    <td key={s.key} className="p-2 text-right tabular-nums">
                      {fmt(t.counts[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats.orgs.length > 0 && <OrgsTable orgs={stats.orgs} />}
    </div>
  );
}

const VIA = { testmu: "TestMu AI claim or team sync", email: "email" } as const;

/** Every org with a participant in it: who is in it, how it was found, and whether it counted. */
function OrgsTable({ orgs }: { orgs: FinalStats["orgs"] }) {
  return (
    <details className="border border-hairline" open>
      <summary className="cursor-pointer p-2 font-plex text-xs text-lightgray">
        {orgs.length} TestMu AI {orgs.length === 1 ? "org" : "orgs"} with participants in them · org → team → people
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] font-plex text-xs">
          <thead>
            <tr className="text-left text-lightgray">
              <th className="p-2 font-normal">Org</th>
              <th className="p-2 font-normal">Team</th>
              <th className="p-2 font-normal">Participants</th>
              <th className="p-2 text-right font-normal">Users on the page</th>
              <th className="p-2 font-normal">Found by</th>
              <th className="p-2 text-right font-normal">Test runs</th>
              <th className="p-2 font-normal">Counted</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.org} className={`border-t border-hairline ${o.counted ? "text-bright" : "text-lightgray"}`}>
                <td className="p-2 tabular-nums">{o.org}</td>
                <td className="p-2">{o.team?.name ?? "No team"}</td>
                <td className="p-2">{o.participants.join(", ")}</td>
                <td className="p-2 text-right tabular-nums">{o.users == null ? "—" : fmt(o.users)}</td>
                <td className="p-2">{VIA[o.via]}</td>
                <td className="p-2 text-right tabular-nums">{fmt(o.counts.test_runs)}</td>
                <td className="p-2">{o.counted ? "Yes" : "No, shared with non-participants"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
