"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api-client";

// /setup → the team's Idea tab. Setup counts as done once a machine is signed in
// (the idea comes before the first Kane run). Already done when the page opened: just a button
// (so people can come back to setup). Done while the page is open: move on by itself.
export default function OnToIdea({ ideaUrl, done }: { ideaUrl: string; done: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (done) return;
    let stop = false;
    const id = setInterval(async () => {
      try {
        const j = (await (await apiFetch("/api/v1/me/flow", { cache: "no-store" })).json()) as { setupDone?: boolean; ideaUrl?: string | null };
        if (!stop && j.setupDone) router.push(j.ideaUrl ?? ideaUrl);
      } catch {
        // offline for a moment: try again on the next tick
      }
    }, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [done, ideaUrl, router]);
  if (!done) return null;
  return (
    <a href={ideaUrl} className="inline-flex min-h-11 items-center bg-lime px-5 font-plex text-sm text-ink transition-colors hover:bg-bright">
      You&apos;re set up. Next: your team&apos;s idea →
    </a>
  );
}
