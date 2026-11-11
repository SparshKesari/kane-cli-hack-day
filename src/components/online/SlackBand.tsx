import { onlineLinks, slackCta } from "@/data/online";

// A lime band between folds: the one place to ask for help during the week.
export default function SlackBand() {
  return (
    <section id="slack" className="scroll-mt-20 bg-lime text-[#0a0a0a]">
      <div className="container-page flex flex-col items-start justify-between gap-6 py-10 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-dots text-4xl leading-none font-black sm:text-5xl">{slackCta.title}</h2>
          <p className="mt-3 max-w-xl font-plex text-sm leading-relaxed">{slackCta.body}</p>
        </div>
        <a
          href={onlineLinks.slack}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-12 shrink-0 items-center bg-[#0a0a0a] px-6 font-plex text-base text-[#f2f2f2] transition-colors hover:bg-[#2a2a2a]"
        >
          {slackCta.button} →
        </a>
      </div>
    </section>
  );
}
