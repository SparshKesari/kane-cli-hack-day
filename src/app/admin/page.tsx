import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { onlineEvent } from "@/data/online";
import { adminConfigured, adminEmails, adminPeople, adminTeams, isAdmin, type AdminTeam } from "@/lib/online/admin";
import { checkPosts } from "@/lib/online/links";
import { formatWhen } from "@/lib/online/submission";
import { adminLogoutAction, setHiddenAction } from "./actions";
import { AdminLogin, ResetLinkButton } from "./parts";

export const metadata: Metadata = { title: { absolute: `Organiser view · ${onlineEvent.name}` }, robots: { index: false, follow: false } };

// The organiser view for the online hackathon: who registered, every team and
// its submission, the email outbox, CSV exports, hide/unhide, reset links.
export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <div data-online className="min-h-svh">
      <style>{`body:has([data-online]) > #nav-bar, body:has([data-online]) > footer { display: none; } [data-online] { --lightgray: #a8a8a8; }`}</style>
      <Suspense fallback={<p className="container-page py-16 font-plex text-sm text-lightgray">Loading…</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const TABS = ["submissions", "people", "emails"] as const;
const th = "border-b border-hairline px-3 py-2 text-left font-pixel text-xs uppercase tracking-[0.15em] text-lightgray";
const td = "border-b border-dashed border-hairline px-3 py-3 align-top";
const link = "text-bright underline decoration-hairline underline-offset-4 hover:text-lime";
const posts = (t: AdminTeam) => checkPosts(t as unknown as Record<string, string | null>).count;

async function Body({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  if (!(await isAdmin())) {
    return (
      <main className="container-page max-w-sm py-24">
        <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">{onlineEvent.name}</p>
        <h1 className="mb-8 mt-2 font-display text-4xl text-bright">Organiser view</h1>
        {adminConfigured() ? <AdminLogin /> : <p className="font-plex text-sm text-danger">Set ONLINE_ADMIN_PASSWORD (and a session secret) to turn this page on.</p>}
      </main>
    );
  }
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "submissions";
  const [teams, people, emails] = await Promise.all([adminTeams(), adminPeople(), tab === "emails" ? adminEmails() : []]);
  const submitted = teams.filter((t) => t.status === "submitted");
  const stats = [
    ["Registered", people.length],
    ["Teams", teams.length],
    ["Submitted", submitted.length],
    ["Drafts", teams.filter((t) => t.status === "draft").length],
    ["No team yet", people.filter((p) => !p.team).length],
  ] as const;

  return (
    <main className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">{onlineEvent.name}</p>
          <h1 className="mt-2 font-display text-4xl text-bright">Organiser view</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-plex text-sm">
          <a href="/admin/export?what=submissions" className="border border-hairline px-4 py-2 text-bright hover:border-lime">Export submissions (CSV)</a>
          <a href="/admin/export?what=people" className="border border-hairline px-4 py-2 text-bright hover:border-lime">Export people (CSV)</a>
          <form action={adminLogoutAction}>
            <button type="submit" className="text-lightgray hover:text-bright">Log out</button>
          </form>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-5">
        {stats.map(([label, n]) => (
          <div key={label} className="bg-ink p-4">
            <dt className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">{label}</dt>
            <dd className="mt-1 font-dots text-4xl font-black text-bright">{n}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Sections" className="mt-8 inline-flex border border-hairline font-plex text-sm">
        {TABS.map((t) => (
          <Link key={t} href={`/admin?tab=${t}`} aria-current={t === tab ? "page" : undefined} className={`px-4 py-2 capitalize ${t === tab ? "bg-lime text-ink" : "text-lightgray hover:text-bright"}`}>
            {t === "submissions" ? "Teams and submissions" : t}
          </Link>
        ))}
      </nav>

      {tab === "submissions" && (
        <div className="mt-6 space-y-4">
          {teams.length === 0 && <p className="font-plex text-sm text-lightgray">No teams yet.</p>}
          {teams.map((t) => (
            <details key={t.id} className="border border-hairline bg-surface/40">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 p-4 font-plex text-sm">
                <span className={`border px-2 py-0.5 font-pixel text-xs uppercase tracking-[0.15em] ${t.status === "submitted" ? "border-lime text-lime" : "border-hairline text-lightgray"}`}>{t.status ?? "no draft"}</span>
                <span className="font-display text-lg text-bright">{t.project_name ?? "(no project name)"}</span>
                <span className="text-lightgray">
                  {t.solo ? "Solo" : `Team ${t.name}`} · {t.member_count} {t.member_count === 1 ? "person" : "people"} · {posts(t)} posts · {t.files} files
                </span>
                {t.receipt_code && <span className="text-bright">{t.receipt_code}</span>}
                {t.hidden && <span className="border border-danger px-2 py-0.5 text-xs text-danger">Hidden</span>}
              </summary>
              <div className="grid gap-6 border-t border-dashed border-hairline p-4 font-plex text-sm lg:grid-cols-2">
                <dl className="space-y-3">
                  <Row label="Captain (gets the prize)">{t.captain ? `${t.captain} <${t.captain_email}>` : "—"}</Row>
                  <Row label="Members">{t.members || "—"}</Row>
                  <Row label="Team code">{t.invite_code}</Row>
                  <Row label="First submitted">{t.submitted_at ? formatWhen(t.submitted_at) : "—"}</Row>
                  <Row label="Last saved">{t.updated_at ? formatWhen(t.updated_at) : "—"}</Row>
                  <Row label="Agent">{t.agent_used ?? "—"}</Row>
                  <Row label="Links">
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {([["Repo", t.repo_url], ["Video", t.video_url], ["Live", t.live_url]] as const).map(([l, u]) => (u ? <a key={l} href={u} target="_blank" rel="noreferrer" className={link}>{l} ↗</a> : null))}
                      <a href={`/online/p/${t.slug}`} target="_blank" rel="noreferrer" className={link}>Showcase page ↗</a>
                    </span>
                  </Row>
                  <Row label="Posts">
                    <span className="flex flex-col gap-1">
                      {[t.x_url, t.linkedin_url, t.hn_url, t.reddit_url, t.other_posts].flatMap((v) => (v ?? "").split(/[\s,]+/).filter(Boolean)).map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer" className={`${link} break-all`}>{u}</a>
                      ))}
                    </span>
                  </Row>
                </dl>
                <div className="space-y-3">
                  <p className="text-bright">{t.one_line_pitch}</p>
                  <p className="whitespace-pre-line text-lightgray">{t.project_description}</p>
                  {t.more_details && <p className="whitespace-pre-line text-lightgray">{t.more_details}</p>}
                  <form action={setHiddenAction} className="pt-2">
                    <input type="hidden" name="team" value={t.id} />
                    <input type="hidden" name="hidden" value={String(!t.hidden)} />
                    <button type="submit" className={`border px-4 py-2 ${t.hidden ? "border-lime text-lime" : "border-hairline text-bright hover:border-danger hover:text-danger"}`}>
                      {t.hidden ? "Show the showcase page again" : "Hide the showcase page from the public"}
                    </button>
                  </form>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      {tab === "people" && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse font-plex text-sm text-bright">
            <thead>
              <tr>{["Name", "Email", "Team", "Registered", "Last login", "Locked out?"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{p.name}</td>
                  <td className={td}>{p.email}</td>
                  <td className={`${td} ${p.team ? "" : "text-lightgray"}`}>{p.team ?? "none yet"}</td>
                  <td className={`${td} text-lightgray`}>{formatWhen(p.created_at)}</td>
                  <td className={`${td} text-lightgray`}>{p.last_login_at ? formatWhen(p.last_login_at) : "—"}</td>
                  <td className={td}><ResetLinkButton participantId={p.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "emails" && (
        <div className="mt-6 overflow-x-auto">
          <p className="mb-4 font-plex text-sm text-lightgray">The last 100 emails the site wrote. &ldquo;not_configured&rdquo; means sending is switched off (set ONLINE_EMAILS=on to turn it on) or SMTP isn&rsquo;t set up, so that email never left the server.</p>
          <table className="w-full min-w-[48rem] border-collapse font-plex text-sm text-bright">
            <thead>
              <tr>{["When", "To", "Kind", "Subject", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} text-lightgray`}>{formatWhen(e.created_at)}</td>
                  <td className={td}>{e.to_email}</td>
                  <td className={td}>{e.kind}</td>
                  <td className={td}>{e.subject}</td>
                  <td className={`${td} ${e.status === "sent" ? "text-lime" : "text-danger"}`}>{e.status}{e.error ? `: ${e.error}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">{label}</dt>
      <dd className="mt-1 break-words text-bright">{children}</dd>
    </div>
  );
}
