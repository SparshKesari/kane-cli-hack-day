import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import { Eyebrow } from "@/components/ui/Section";
import StatusPill from "@/components/ui/StatusPill";
import { getStaff } from "@/server/auth";
import { getPassport, resolveBadgeToken, toPublicPassport } from "@/server/passport";
import { BackSection, Chips, PassportBack, PassportFront } from "../../PassportCard";

export const metadata: Metadata = { title: "Badge", robots: { index: false, follow: false } };

// What a badge QR opens. Anyone: the public passport (allow-listed DTO, no
// email, no P-code, portrait only with consent). Staff: also the offline ID
// and admission state. Revoked, expired or
// forged tokens fail closed.

export default function BadgeScanPage({ params }: PageProps<"/passport/b/[token]">) {
  return (
    <main className="py-12 sm:py-16">
      <div className="container-page max-w-3xl">
        <Suspense fallback={<p className="font-plex text-sm text-lightgray">Checking badge…</p>}>
          <Scan params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Scan({ params }: Pick<PageProps<"/passport/b/[token]">, "params">) {
  const { token } = await params;
  const hit = await resolveBadgeToken(decodeURIComponent(token));
  if (hit.status !== "ok") {
    return (
      <DegradedServiceAlert state="down" system="Badge" manualRoute="/help" manualLabel="Help desk">
        {hit.status === "revoked"
          ? "This badge was replaced. Ask the holder for their current badge, or check them in by their P-code."
          : hit.status === "expired"
            ? "This badge has expired."
            : "This isn’t a valid Kane Hack Day badge."}
      </DegradedServiceAlert>
    );
  }
  const [p, staff] = await Promise.all([getPassport(hit.memberId), getStaff()]);
  const pub = toPublicPassport(p);

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="mx-auto w-full max-w-[22rem]">
        <PassportFront
          face={{
            short_name: pub.short_name,
            role_tag: pub.role_tag,
            handle: pub.github ? `@${pub.github}` : pub.x ? `@${pub.x}` : null,
            edition: pub.edition,
            portrait_src: pub.portrait_src,
            activated: pub.activated,
            kane_verified: pub.kane_verified,
            team_label: pub.team ? `Team ${pub.team.name}` : "Builder",
          }}
        />
      </div>
      <div className="space-y-6">
        <Eyebrow>Kane Hack Day · Badge</Eyebrow>
        <h1 className="font-display text-4xl font-semibold text-bright">{pub.short_name}</h1>
        {staff && (
          <section aria-label="Staff view" className="border border-warning bg-warning-deep p-4 font-plex text-sm text-bright">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-warning">Staff only</p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-lightgray">Offline ID</dt>
                <dd className="font-dots text-2xl">{p.member.public_code}</dd>
              </div>
              <div>
                <dt className="text-xs text-lightgray">Admission</dt>
                <dd>{p.member.admission_state.replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-lightgray">Help</dt>
                <dd>{p.help ? `${p.help.code} · ${p.help.status}` : "None open"}</dd>
              </div>
            </dl>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {pub.activated ? <span className="font-plex text-sm text-bright">Activated</span> : <StatusPill tone="unverified">Not activated</StatusPill>}
          {pub.kane_verified && <StatusPill tone="verified">Verified · Kane browser check</StatusPill>}
        </div>
        <div className="max-w-[22rem]">
          <PassportBack>
            <BackSection title="Skills">
              <Chips items={pub.skills} empty="Not shared" />
            </BackSection>
            <BackSection title="Focus">
              <Chips items={pub.interests} empty="Not shared" />
            </BackSection>
            <BackSection title="Team">
              {pub.team ? (
                pub.team.ship_href ? (
                  <Link href={pub.team.ship_href} className="underline underline-offset-2">
                    {pub.team.name} · showcase
                  </Link>
                ) : (
                  pub.team.name
                )
              ) : (
                "Not shared"
              )}
            </BackSection>
            <BackSection title="Links">{[pub.github && `github.com/${pub.github}`, pub.x && `x.com/${pub.x}`].filter(Boolean).join(" · ") || "Not shared"}</BackSection>
          </PassportBack>
        </div>
      </div>
    </div>
  );
}
