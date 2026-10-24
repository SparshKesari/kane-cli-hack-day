import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import Mentions from "@/components/home/Mentions";
import { Eyebrow } from "@/components/ui/Section";
import type { HubTab } from "@/lib/hub";
import { getMemberSession, isAdmin } from "@/lib/session";
import { getMembers, getTeamBySlug, type Member, type Team } from "@/lib/teams";
import { SessionButtons } from "./parts";
import Bell from "./Bell";
import TabNav from "./TabNav";
import { trackLabel } from "@/data/hackday";

// The shell every hub tab renders in. It gates on the team cookie (password,
// then "who are you?") and only then renders the tab, so nothing behind it
// reaches a signed-out visitor. Admins can open any hub read-only.

export type HubContext = {
  team: Team;
  members: Member[];
  /** The signed-in member; null when an admin is looking. */
  me: Member | null;
};

type Params = PageProps<"/t/[slug]">["params"];

export default function Hub({
  params,
  searchParams,
  tab,
  children,
  publicView,
}: {
  params: Params;
  searchParams?: PageProps<"/t/[slug]">["searchParams"];
  tab: HubTab;
  children: (ctx: HubContext) => ReactNode;
  /** When set, signed-out visitors see this instead of the password gate. */
  publicView?: (team: Team) => ReactNode;
}) {
  return (
    <main>
      <Suspense fallback={<p className="container-page py-24 font-plex text-sm text-lightgray">Loading team…</p>}>
        <Gated params={params} searchParams={searchParams} tab={tab} render={children} publicView={publicView} />
      </Suspense>
    </main>
  );
}

async function Gated({
  params,
  searchParams,
  tab,
  render,
  publicView,
}: {
  params: Params;
  searchParams?: PageProps<"/t/[slug]">["searchParams"];
  tab: HubTab;
  render: (ctx: HubContext) => ReactNode;
  publicView?: (team: Team) => ReactNode;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();

  const [personal, admin, members] = await Promise.all([getMemberSession(), isAdmin(), getMembers(team.id)]);
  // The hub opens for any member of this team signed in as themselves
  // (personal password, desk code). There is no shared team password.
  const me = personal?.personal ? (members.find((m) => m.id === personal.memberId) ?? null) : null;
  await searchParams;

  if (!me && !admin && publicView) {
    return (
      <>
        <HubHeader team={team} />
        {publicView(team)}
      </>
    );
  }

  if (!me && !admin) {
    const next = `/t/${slug}${tab ? `/${tab}` : ""}`;
    return (
      <>
        <HubHeader team={team} />
        <section className="py-16 sm:py-20">
          <div className="container-page max-w-md space-y-6">
            {personal?.personal ? (
              <GateTitle title="Not your team’s hub" body="You’re signed in, but not as a member of this team. Your own team is one click away." />
            ) : (
              <GateTitle title="Sign in as yourself" body="Use the email and password you chose at registration, or a one-time code from the desk." />
            )}
            <div className="flex flex-wrap gap-3">
              {personal?.personal ? (
                <Link href="/team" className="inline-flex min-h-11 items-center bg-bright px-4 py-2.5 font-plex text-sm text-ink transition-colors hover:bg-lime">
                  Your team →
                </Link>
              ) : (
                <Link href={`/passport/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center bg-bright px-4 py-2.5 font-plex text-sm text-ink transition-colors hover:bg-lime">
                  Sign in →
                </Link>
              )}
            </div>
          </div>
        </section>
      </>
    );
  }

  // Tabs render on the server only; nothing here is passed to the client wholesale.
  const ctx: HubContext = { team, members, me };
  return (
    <>
      <HubHeader team={team} slug={slug} me={me} showSession={tab !== ""} />
      {render(ctx)}
      <Mentions />
    </>
  );
}

function HubHeader({ team, slug, me, showSession }: { team: Team; slug?: string; me?: Member | null; showSession?: boolean }) {
  return (
    <header className="border-b border-dashed border-hairline pt-12 sm:pt-16">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <Eyebrow>
              {team.is_solo ? "Solo" : "Team"} hub · {trackLabel(team.track)}
            </Eyebrow>
            <h1 className="mt-3 font-dots text-[2.25rem] leading-[0.95] font-black break-words text-bright sm:text-[3rem]">{team.name}</h1>
            <p className="mt-3 max-w-2xl font-plex text-sm text-lightgray">{team.idea}</p>
          </div>
          <div className="flex items-start gap-4">
          {showSession && (
            <div className="font-plex text-xs text-lightgray">
              {me ? (
                <>
                  Signed in as <span className="text-lime">{me.name}</span>
                  <SessionButtons slug={slug!} compact />
                </>
              ) : (
                <span className="border border-lime px-2 py-1 font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">Viewing as admin</span>
              )}
            </div>
          )}
          {me && slug && <Bell slug={slug} />}
          </div>
        </div>
        {slug && (
          <Suspense fallback={<div className="mt-8 h-11" />}>
            <TabNav slug={slug} />
          </Suspense>
        )}
        {!slug && <div className="pb-10" />}
      </div>
    </header>
  );
}

function GateTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl text-bright">{title}</h2>
      <p className="mt-2 font-plex text-sm text-lightgray">{body}</p>
    </div>
  );
}
