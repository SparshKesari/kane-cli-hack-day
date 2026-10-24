import Link from "next/link";
import { getMemberSession } from "@/lib/session";
import { getMemberById } from "@/server/auth";
import { avatarSrc, avatarVersion } from "@/server/avatar";
import { flowState } from "@/server/flow";
import NotificationBell from "./NotificationBell";
import { Avatar } from "./ui/Avatar";

export { Avatar };

// Navbar's right-hand side: Start here (the install command on the homepage), or (signed in as yourself)
// a "continue" link to wherever you are in the flow and your avatar (the
// photo from /register, else your initials), which opens your profile.
// Reads the session cookie, so it streams in behind a Suspense boundary.
export default async function Account() {
  let session = null;
  try {
    session = await getMemberSession();
  } catch {
    // A form posted before hydration re-renders the whole page inside the
    // action, where Next.js 16.4 throws on cookies() here. The page still
    // works, so fall back to the signed-out links for that one response.
  }
  const member = session?.personal ? await getMemberById(session.memberId) : null;
  if (!member) return <SignedOut />;
  const [v, state] = await Promise.all([avatarVersion(member.id), flowState(member.id)]);
  const name = member.display_name ?? member.name;
  return (
    <span className="flex items-center gap-4">
      <NotificationBell />
      <Link href={state.stage === "hub" && state.teamSlug ? `/t/${state.teamSlug}` : state.next} className="bg-bright px-3 py-1.5 font-plex text-sm text-ink transition-colors hover:bg-lime">
        {state.stage === "hub" ? "My team" : "Continue →"}
      </Link>
      <Link href="/passport" aria-label={`Your profile (${name})`} title={name} className="block shrink-0" data-avatar={v ? "photo" : "monogram"}>
        <Avatar name={name} src={v ? avatarSrc(member.id, v) : null} size={36} />
      </Link>
    </span>
  );
}

export function SignedOut() {
  return (
    <span className="flex items-center gap-4">
      <Link href="/#start" className="bg-bright px-3 py-1.5 font-plex text-sm text-ink transition-colors hover:bg-lime">
        Start here
      </Link>
    </span>
  );
}

