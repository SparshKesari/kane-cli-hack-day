import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import CopyField from "@/components/ui/CopyField";
import { beforeYouStart, onlineLinks, onlineResources, socialAccounts } from "@/data/online";
import { getMe } from "@/lib/online/team";
import Icon from "../Icons";
import Steps from "../Steps";

export const metadata: Metadata = { title: "Get set up" };

const linkCls = "text-bright underline decoration-hairline underline-offset-4 hover:text-lime";

// Step 3: activate Kane CLI and get the social accounts ready. The posting
// guide itself is at /online/launch.
export default function OnlineStart() {
  return (
    <section className="container-page max-w-3xl py-16">
      <Suspense>
        <Guard />
      </Suspense>
      <Steps current={3} />
      <h1 className="font-display text-4xl text-bright">Get set up</h1>
      <p className="mt-3 font-plex text-sm text-lightgray">Activate Kane CLI, then start building. Ten minutes now saves an hour later.</p>

      <H2 n="01">Activate Kane CLI</H2>
      <ol className="border-t border-dashed border-hairline">
        <Row n={1} title="Register on TestMu AI">
          <p>Create your free TestMu AI account first. Use the same email you registered here with: entries without a TestMu AI account can&rsquo;t be scored.</p>
          <a href={onlineLinks.register} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center bg-lime px-5 font-plex text-sm text-ink transition-colors hover:bg-bright">
            Register on TestMu AI →
          </a>
        </Row>
        <Row n={2} title="Claim your Kane CLI licence">
          <p>10,000 free credits on that account, valid for one month.</p>
          <a href={onlineLinks.claim} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center border border-lime px-5 font-plex text-sm text-lime transition-colors hover:bg-lime hover:text-ink">
            Claim your Kane CLI licence →
          </a>
        </Row>
        <Row n={3} title="Install Kane CLI">
          <CopyField value={beforeYouStart.steps[1].command ?? ""} />
        </Row>
        <Row n={4} title="Run one flow">
          <p>
            Try an example from the{" "}
            <a href={onlineLinks.docs} target="_blank" rel="noreferrer" className={linkCls}>
              Kane CLI docs
            </a>{" "}
            so you know it works before day one.
          </p>
        </Row>
        <Row n={5} title="Join the Slack group">
          <p>
            Questions, help from the Kane CLI engineers, and extra credits if you run low.{" "}
            <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className={linkCls}>
              Join Slack →
            </a>
          </p>
        </Row>
      </ol>

      <H2 n="02">Activate your social accounts</H2>
      <p className="mb-6 font-plex text-sm leading-relaxed text-lightgray">{socialAccounts.intro}</p>
      <ol className="border-t border-dashed border-hairline">
        {socialAccounts.items.map((a, i) => (
          <li key={a.name} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 border-b border-dashed border-hairline py-6">
            <span className="font-dots text-3xl leading-none font-black text-lime">{i + 1}</span>
            <div>
              <h3 className="flex items-center gap-3 font-display text-xl text-bright">
                <Icon name={a.icon} className="h-5 w-5" />
                {a.name}
              </h3>
              <p className="mt-2 font-plex text-sm leading-relaxed text-lightgray">{a.body}</p>
              <a href={a.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                {a.cta} ↗
              </a>
            </div>
          </li>
        ))}
      </ol>

      <H2 n="03">Plan your launch posts</H2>
      <div className="bg-lime p-6 text-[#0a0a0a] sm:p-8">
        <p className="font-display text-2xl">At least two public posts are required. More posts earn brownie points.</p>
        <p className="mt-2 max-w-xl font-plex text-sm leading-relaxed">The launch guide has the hashtags, who to tag on each platform, and sample posts you can copy.</p>
        <Link href="/online/launch" className="mt-5 inline-flex min-h-11 items-center bg-[#0a0a0a] px-5 font-plex text-sm text-[#f2f2f2] transition-colors hover:bg-[#2a2a2a]">
          Open the launch guide →
        </Link>
      </div>

      <H2 n="04">Resources</H2>
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {onlineResources.map((r) => (
          <li key={r.href}>
            <a href={r.href} target="_blank" rel="noreferrer" className={`font-plex text-sm ${linkCls}`}>
              {r.label} ↗
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap gap-3 border-t border-dashed border-hairline pt-8">
        <Link href="/online/submit" className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">
          Go to your submission →
        </Link>
        <Link href="/online/team" className="inline-flex min-h-11 items-center border border-hairline px-5 font-plex text-sm text-bright transition-colors hover:border-lime">
          Your team
        </Link>
      </div>
    </section>
  );
}

async function Guard() {
  const me = await getMe();
  if (!me) redirect("/online/login");
  if (me.teamId === null) redirect("/online/team");
  return null;
}

// A numbered part of the page: "Part 01", then the heading.
function H2({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="mt-16 mb-6 flex items-center gap-4 border-t border-hairline pt-8 font-display text-3xl text-bright">
      <span aria-hidden className="font-dots text-4xl leading-none font-black text-lime">
        {n}
      </span>
      <span>
        <span className="sr-only">Part {Number(n)}: </span>
        {children}
      </span>
    </h2>
  );
}

function Row({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 border-b border-dashed border-hairline py-6">
      <span className="font-dots text-3xl leading-none font-black text-lime">{n}</span>
      <div>
        <h3 className="font-display text-xl text-bright">{title}</h3>
        <div className="mt-2 font-plex text-sm leading-relaxed text-lightgray">{children}</div>
      </div>
    </li>
  );
}
