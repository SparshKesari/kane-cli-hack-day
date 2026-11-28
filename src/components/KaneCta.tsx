"use client";
// Sticky "try Kane CLI" bar from the growth kit (kaneclihack-growth/01). Mounted once in
// app/layout.tsx; styles are the .kcta block in globals.css. Shown only on the public pages
// visitors land on during judging week: never on /ship/** (frozen) or organiser/participant tools.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const showOn = (p: string) => p === "/" || p === "/showcase" || p === "/o" || p.startsWith("/o/p/");

const KEY = "kcta-dismissed";
const DAYS = 14;
const UTM = "utm_source=kaneclihack&utm_medium=referral&utm_campaign=kanecli_hackathon_nov26";

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}
const track = (name: string, params: Record<string, string> = {}) => {
  if (typeof window.gtag === "function") window.gtag("event", name, params);
};

const noSubscribe = () => () => {};
const wasDismissed = () => {
  try {
    const t = parseInt(localStorage.getItem(KEY) || "0", 10);
    return Boolean(t && Date.now() - t < DAYS * 864e5);
  } catch {
    return false;
  }
};

export default function KaneCta() {
  const pathname = usePathname();
  return showOn(pathname) ? <Bar /> : null;
}

function Bar() {
  // Dismissed within the last 14 days? Read on the client only; the server render keeps the bar hidden.
  const recentlyDismissed = useSyncExternalStore(noSubscribe, wasDismissed, () => true);
  const [closed, setClosed] = useState(false);
  const open = !recentlyDismissed && !closed;
  const ref = useRef<HTMLElement>(null);

  // Pad the page by the bar's real height so it never covers the last card or the footer.
  // ResizeObserver has no fallback here: every browser in support since 2020 has it (the HTML version falls back to window resize).
  useEffect(() => {
    if (!open || !ref.current) return;
    const body = document.body;
    const base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    const el = ref.current;
    const fit = () => { body.style.paddingBottom = `${base + el.offsetHeight}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { ro.disconnect(); body.style.paddingBottom = base ? `${base}px` : ""; };
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    setClosed(true); // effect cleanup removes the padding
    try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    track("kcta_dismiss");
    // keyboard users: send focus to the main content instead of dropping it on <body>
    const m = document.querySelector<HTMLElement>('main, [role="main"], #main');
    if (m) { if (!m.hasAttribute("tabindex")) m.setAttribute("tabindex", "-1"); m.focus({ preventScroll: true }); }
  };

  return (
    <aside ref={ref} className="kcta" role="region" aria-label="Try Kane CLI">
      <div className="kcta__in">
        <p className="kcta__txt">
          <b>Kane CLI tests what your coding agent builds.</b> Install it free and claim 10,000 credits, valid for 30 days.
        </p>
        <a className="kcta__btn kcta__btn--p"
           href={`https://www.testmuai.com/kane-cli/?${UTM}&utm_content=sticky_credits#creditOffer`}
           onClick={(e) => track("kcta_click", { link_url: e.currentTarget.href, utm_content: "sticky_credits" })}>
          Claim 10,000 credits
        </a>
        <a className="kcta__btn kcta__btn--s"
           href={`https://www.testmuai.com/support/docs/kane-cli-introduction/?${UTM}&utm_content=sticky_docs`}
           onClick={(e) => track("kcta_click", { link_url: e.currentTarget.href, utm_content: "sticky_docs" })}>
          Quickstart
        </a>
        <button type="button" className="kcta__x" aria-label="Dismiss Kane CLI banner" onClick={dismiss}>
          &times;
        </button>
      </div>
    </aside>
  );
}
