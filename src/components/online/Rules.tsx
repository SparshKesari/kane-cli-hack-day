import { guidelines, onlineLinks, onlineRules, whoCanEnter } from "@/data/online";
import { Eyebrow, Fold, SectionHeading } from "@/components/ui/Section";

// Who can enter, then the rules as an accordion (the SF
// page's FAQ layout), with the contest guidelines folded away at the end.
export default function Rules() {
  return (
    <Fold id="rules">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <SectionHeading
            eyebrow="Rules & FAQ"
            dim="The rules,"
            bright="No surprises."
            intro={
              <>
                Break one and you can&rsquo;t place. Anything else? Ask on{" "}
                <a href={onlineLinks.slack} target="_blank" rel="noreferrer" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                  Slack
                </a>{" "}
                or write to{" "}
                <a href={onlineLinks.support} className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                  conferences@testmuai.com
                </a>
                .
              </>
            }
          />
          <div className="mt-10">
            <Eyebrow>Who can enter</Eyebrow>
            <ul className="mt-4 space-y-2 font-plex text-sm text-bright">
              {whoCanEnter.map((w) => (
                <li key={w} className="flex gap-3">
                  <span aria-hidden className="text-lime">→</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-dashed border-hairline">
          {onlineRules.map((r, i) => (
            <details key={r.title} className="group border-b border-dashed border-hairline" open={i === 0}>
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 font-display text-lg text-bright">
                {r.title}
                <span aria-hidden className="font-plex text-sm text-lightgray transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              {r.body && <p className="pb-5 font-plex text-sm leading-relaxed text-lightgray">{r.body}</p>}
            </details>
          ))}
          <details className="group border-b border-dashed border-hairline">
            <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 font-display text-lg text-bright">
              Contest guidelines
              <span aria-hidden className="font-plex text-sm text-lightgray transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-4 font-plex text-sm text-lightgray">
              The full{" "}
              <a href={onlineLinks.terms} target="_blank" rel="noreferrer" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                terms and conditions ↗
              </a>{" "}
              apply.
            </p>
            <ul className="space-y-3 pb-5 font-plex text-sm leading-relaxed text-lightgray">
              {guidelines.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </Fold>
  );
}
