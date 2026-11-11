"use client";

import { useState } from "react";

const btn = "inline-flex min-h-10 items-center border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime";

/** Copy the page link, or open a pre-filled X / LinkedIn post about it. */
export default function ShareBar({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const here = () => window.location.href;
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={btn}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(here());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          } catch {
            // Clipboard can be unavailable; the address bar still has the link.
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <button type="button" className={btn} onClick={() => open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(here())}`)}>
        Share on X ↗
      </button>
      <button type="button" className={btn} onClick={() => open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(here())}`)}>
        Share on LinkedIn ↗
      </button>
    </div>
  );
}
