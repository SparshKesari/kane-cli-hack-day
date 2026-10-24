import { activationEnabled } from "@/lib/testmu-provision";
import { getTestmuIdentity, takeRevealedKey } from "@/server/testmu";
import { forgetRevealedKeyAction } from "./actions";

// The TestMu AI step of the profile: once the profile is saved we activate the
// person on TestMu AI and its username + access key become their sign-in for
// everything after. Shown above the next step: the key once (for Kane CLI and
// Codex), or a retry when activation didn't go through.

const button = "inline-flex min-h-11 items-center justify-center border border-hairline px-4 py-2.5 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime";

export default async function TestmuPanel({ failed }: { failed: boolean }) {
  if (!activationEnabled()) return null;
  const [key, identity] = await Promise.all([takeRevealedKey(), getTestmuIdentity()]);
  if (key) {
    return (
      <div className="mb-10 border border-lime p-5" data-testmu="revealed">
        <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">TestMu AI activated</p>
        <p className="mt-3 font-plex text-sm leading-relaxed text-lightgray">
          This is your TestMu AI username and access key. Kane CLI and Codex use them to sign in as you. Save them now: we don’t keep the key, so this page won’t show it again.
        </p>
        <dl className="mt-4 grid gap-2 font-mono text-sm text-bright">
          <div><dt className="inline text-lightgray">Username </dt><dd className="inline select-all break-all">{key.username}</dd></div>
          <div><dt className="inline text-lightgray">Access key </dt><dd className="inline select-all break-all">{key.accessKey}</dd></div>
        </dl>
        <form action={forgetRevealedKeyAction} className="mt-4">
          <button type="submit" className={button}>I’ve saved it</button>
        </form>
      </div>
    );
  }
  if (identity && !failed) return null;
  return (
    <div className="mb-10 border-l-2 border-warning pl-4" data-testmu="needed">
      <p className="font-plex text-sm text-bright">{failed ? "We couldn’t activate your TestMu AI account yet." : "Your TestMu AI account isn’t activated on this device yet."}</p>
      <p className="mt-1 font-plex text-sm text-lightgray">You need it for the next steps. Try again; if it keeps failing, the help desk can sort it out.</p>
      <a href="/api/v1/auth/testmu/start?next=/register" className={`${button} mt-3`}>Activate TestMu AI</a>
    </div>
  );
}
