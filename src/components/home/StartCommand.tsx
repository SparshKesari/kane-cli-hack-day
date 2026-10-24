import Link from "next/link";
import CopyField from "@/components/ui/CopyField";
import { startCommands } from "@/data/hackday";

// The way in, on the homepage: install the kanehack helper and the hack-day skills, then
// run $hack-os in Codex, which signs people up and walks them through the day. There is no
// web sign-in here; /passport/login stays reachable by URL for `kanehack pair` and submission.
export default function StartCommand({ id, className = "" }: { id?: string; className?: string }) {
  return (
    <div id={id} className={`w-full max-w-md scroll-mt-24 text-left ${className}`}>
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">1 · Install · macOS / Linux</p>
      <CopyField value={startCommands.unix} className="mt-2" />
      <p className="mt-3 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Windows · PowerShell</p>
      <CopyField value={startCommands.windows} className="mt-2" />
      <p className="mt-4 font-plex text-sm leading-relaxed text-lightgray">
        2 · Then start a new Codex session and type <code className="text-bright">$hack-os</code>. It signs you up, sets up your team and gets your Codex coupon.
      </p>
      <p className="mt-3 font-plex text-sm leading-relaxed text-lightgray">
        <Link href="/start" className="text-bright underline underline-offset-4 hover:text-lime">
          The whole flow, step by step →
        </Link>{" "}
        Point your agent there for the full context.
      </p>
    </div>
  );
}
