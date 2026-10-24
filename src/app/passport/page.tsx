import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Account";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { getPersonalMember } from "@/server/auth";
import { avatarSrc, avatarVersion } from "@/server/avatar";
import { uiFlowState } from "@/server/flow-ui";
import { listBearerTokens } from "@/server/pairing";
import { getPassport } from "@/server/passport";
import { revokeToken, signOut } from "./actions";
import { LoginCodeButton, PasswordForm, RemovePhotoButton } from "./forms";

export const metadata: Metadata = { title: "Your profile", robots: { index: false } };

// The lean profile page of the event-day flow: who you are (photo, name,
// skills), your team, where you are in the flow, and this device's sign-in
// and paired machines. Editing goes back through the /register steps.

export default function PassportPage() {
  return (
    <main>
      <PageHeader eyebrow="Profile" dim="This is you," bright="At the event." />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading your profile…</p>}>
            <Body />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

const eyebrow = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

async function Body() {
  const member = await getPersonalMember();
  if (!member) {
    return (
      <div className="max-w-xl space-y-4 font-plex text-sm text-lightgray">
        <p>Sign in to see your profile.</p>
        <div className="flex flex-wrap gap-3">
          <Button href="/passport/login?next=/passport" className="min-h-11">
            Sign in →
          </Button>
          <Button href="/register" variant="secondary" className="min-h-11">
            Start here
          </Button>
        </div>
      </div>
    );
  }
  const [p, tokens, v, state] = await Promise.all([getPassport(member.id), listBearerTokens(member.id), avatarVersion(member.id), uiFlowState(member.id)]);
  const name = p.member.display_name ?? p.member.name;
  const hasPhoto = !!v && p.consents.selfie_storage !== false;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="space-y-10">
        <div className="brackets flex flex-wrap items-center gap-6 border border-hairline p-5 sm:p-6">
          <Avatar name={name} src={hasPhoto ? avatarSrc(member.id, v) : null} size={96} />
          <div className="min-w-0 space-y-1">
            <p className="font-display text-3xl text-bright">{name}</p>
            <p className="font-plex text-xs text-lightgray">
              {p.member.email_hint}
              {p.member.public_code ? ` · badge ${p.member.public_code}` : ""}
            </p>
            {(p.member.github_handle || p.member.x_handle) && (
              <p className="font-plex text-xs text-lightgray">
                {[p.member.github_handle && `GitHub @${p.member.github_handle}`, p.member.x_handle && `X @${p.member.x_handle.replace(/^@/, "")}`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <TagList title="Skills" items={p.member.skills} />
          <TagList title="Interests" items={p.member.interests} />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button href="/register?edit=profile" variant="secondary" className="min-h-11">
            Edit profile
          </Button>
          <Button href="/register?edit=photo" variant="secondary" className="min-h-11">
            {hasPhoto ? "Retake photo" : "Add a photo"}
          </Button>
          {hasPhoto && <RemovePhotoButton />}
        </div>

        <div className="border-t border-dashed border-hairline pt-6">
          <p className={eyebrow}>Team</p>
          {p.team ? (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <p className="font-display text-2xl text-bright">{p.team.name}</p>
              <span className="font-plex text-xs text-lightgray">
                {p.team.size} {p.team.size === 1 ? "person" : "people"}
                {p.team.role === "captain" ? " · you're captain" : ""}
              </span>
              <Link href={`/t/${p.team.slug}`} className="font-plex text-sm text-bright underline underline-offset-4 hover:text-lime">
                Team hub →
              </Link>
            </div>
          ) : (
            <p className="mt-3 font-plex text-sm text-lightgray">
              No team yet.{" "}
              <Link href={state.next} className="text-bright underline underline-offset-4 hover:text-lime">
                Continue →
              </Link>
            </p>
          )}
          {state.stage !== "hub" && (
            <div className="mt-5">
              <Button href={state.next} className="min-h-11">
                Continue where you left off →
              </Button>
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-10">
        <div className="space-y-4">
          <p className={eyebrow}>Paired devices</p>
          {tokens.length === 0 ? (
            <p className="font-plex text-sm text-lightgray">No machine paired yet.</p>
          ) : (
            <ul className="border-t border-dashed border-hairline">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-hairline py-2.5 font-plex text-sm">
                  <span className="text-bright">
                    {t.label ?? "kanehack"}
                    <span className="block text-xs text-lightgray">
                      paired {t.created_at.toLocaleDateString()} {t.last_used_at ? `· last used ${t.last_used_at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                    </span>
                  </span>
                  <form action={revokeToken}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="min-h-11 border border-hairline px-3 font-plex text-xs text-bright hover:border-danger hover:text-danger">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {tokens.length > 0 ? <StatusPill tone="neutral">{tokens.length} paired</StatusPill> : <StatusPill tone="pending">Not paired</StatusPill>}
            <Link href="/pair" className="font-plex text-sm text-bright underline underline-offset-4 hover:text-lime">
              Approve a pairing code →
            </Link>
            <Link href="/setup" className="font-plex text-sm text-lightgray underline underline-offset-4 hover:text-lime">
              Set up Codex
            </Link>
          </div>
        </div>

        <div className="space-y-4 border-t border-dashed border-hairline pt-6">
          <p className={eyebrow}>Sign-in</p>
          <PasswordForm />
          <LoginCodeButton />
          <form action={signOut}>
            <button type="submit" className="min-h-11 border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

function TagList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className={eyebrow}>{title}</p>
      {items.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {items.map((s) => (
            <li key={s} className="border border-hairline px-2 py-0.5 font-plex text-xs text-bright">
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 font-plex text-sm text-lightgray">None added.</p>
      )}
    </div>
  );
}
