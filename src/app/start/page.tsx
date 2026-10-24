import type { Metadata } from "next";
import CopyField from "@/components/ui/CopyField";
import PageHeader from "@/components/ui/PageHeader";
import { START_MD_URL, startGuide, startGuideIntro, type GuideBlock } from "@/data/start-guide";

export const metadata: Metadata = {
  title: "Start here",
  description: "The whole Kane CLI Hack Day flow in one place, for you and your agent: install, $hack-os in Codex, team, activation, idea, build with Kane CLI, submit.",
  alternates: { types: { "text/markdown": "/start.md" } },
};

// The whole participant flow for people and their agents, in /setup's layout (step label,
// title and summary on the left; commands and details on the right). Content:
// src/data/start-guide.ts, also served as markdown at /start.md. Public and static.

const eyebrow = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";
const rows = "divide-y divide-dashed divide-hairline border-y border-dashed border-hairline";
const AGENT_PROMPT = `Read ${START_MD_URL}, then run $hack-os with me.`;

export default function StartPage() {
  return (
    <main className="[overflow-wrap:anywhere]">
      <PageHeader
        eyebrow="Start here"
        dim="The whole day,"
        bright="in one place."
        intro={
          <>
            <p>
              <Inline text={startGuideIntro} />
            </p>
            <div className="mt-8 border border-dashed border-lime/70 bg-surface p-5">
              <p className="font-pixel text-[11px] uppercase tracking-[0.2em] text-lime">Point your agent here</p>
              <CopyField value={START_MD_URL} className="mt-3" />
              <p className="mt-4 font-plex text-xs text-lightgray">Or paste this into Codex:</p>
              <CopyField value={AGENT_PROMPT} className="mt-2" />
            </div>
          </>
        }
        jumps={startGuide.map((s) => ({ href: `#${s.id}`, label: s.jump }))}
      />
      {startGuide.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-dashed border-hairline py-12 sm:py-16">
          <div className="container-page grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <div>
              <p className={eyebrow}>{s.eyebrow}</p>
              <h2 className="mt-2 font-display text-2xl tracking-[-0.02em] text-bright sm:text-3xl">{s.title}</h2>
              <p className="mt-3 font-plex text-sm text-lightgray">
                <Inline text={s.summary} />
              </p>
            </div>
            <div className="min-w-0 space-y-6">
              {s.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}

function Block({ b }: { b: GuideBlock }) {
  if ("p" in b)
    return (
      <p className="font-plex text-sm leading-relaxed text-lightgray">
        <Inline text={b.p} />
      </p>
    );
  if ("code" in b)
    return (
      <div>
        {b.label && <p className="font-plex text-sm text-bright">{b.label}</p>}
        <CopyField value={b.code} className={b.label ? "mt-2" : ""} />
        {b.note && (
          <p className="mt-2 font-plex text-xs text-lightgray">
            <Inline text={b.note} />
          </p>
        )}
      </div>
    );
  if ("timeline" in b)
    return (
      <ol className={rows}>
        {b.timeline.map((t) => (
          <li key={t.time} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 py-3 font-plex text-sm">
            <span className="text-bright tabular-nums">{t.time}</span>
            <span className="text-lightgray">{t.text}</span>
          </li>
        ))}
      </ol>
    );
  const numbered = "steps" in b;
  const items = numbered ? b.steps : b.list;
  return (
    <ul className={rows}>
      {items.map((x, i) => (
        <li key={i} className={`py-3 font-plex text-sm leading-relaxed text-lightgray ${numbered ? "grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2" : ""}`}>
          {numbered && <span className="font-pixel text-[11px] tracking-[0.2em] text-lime">{String(i + 1).padStart(2, "0")}</span>}
          <span>
            <Lead text={x} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A list item: its words before the first ": " in bright, then the rest. */
function Lead({ text }: { text: string }) {
  const at = text.indexOf(": ");
  if (at < 1 || at > 60 || text.slice(0, at).includes("`")) return <Inline text={text} />;
  return (
    <>
      <span className="text-bright">{text.slice(0, at)}:</span> <Inline text={text.slice(at + 2)} />
    </>
  );
}

/** `code` and https:// links inside a line of guide text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|https:\/\/[\w./-]*\w)/g).map((s, i) =>
        s.startsWith("`") ? (
          <code key={i} className="text-bright">
            {s.slice(1, -1)}
          </code>
        ) : s.startsWith("https://") ? (
          <a key={i} href={s} className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
            {s}
          </a>
        ) : (
          s
        ),
      )}
    </>
  );
}
