"use client";

import { useState, useTransition } from "react";
import CopyField from "@/components/ui/CopyField";
import { reportWeb } from "./actions";
import { apiFetch } from "@/lib/api-client";

// ReadinessDoctor (T-ACT-08), the interactive half: run the checks a browser
// can do itself (Chrome, API reachable), and let the person record what their
// terminal said for the rest. Partial is fine; every answer can be changed.

type Status = "pass" | "warn" | "fail" | "skip";
export type DoctorCheck = { id: string; label: string; status: Status; command: string | null; fix: string | null; detail: string | null };

const BROWSER_CHECKS = new Set(["chrome", "api_reachability"]);

export default function ReadinessDoctor({ checks }: { checks: DoctorCheck[] }) {
  const [answers, setAnswers] = useState<Record<string, Status>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function browserChecks() {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands.map((b) => b.brand) ?? [];
    const isChrome = brands.includes("Google Chrome") || (/Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent));
    let api: Status = "fail";
    let apiDetail = "Couldn’t reach /api/v1/readiness from this browser";
    try {
      const res = await apiFetch("/api/v1/readiness", { cache: "no-store" });
      if (res.ok) {
        api = "pass";
        apiDetail = "Reached from this browser";
      }
    } catch {}
    return [
      { id: "chrome", status: (isChrome ? "pass" : "warn") as Status, detail: isChrome ? "This browser is Chrome" : "This browser isn’t Chrome; Kane needs Chrome installed" },
      { id: "api_reachability", status: api, detail: apiDetail },
    ];
  }

  function submit() {
    setMsg(null);
    start(async () => {
      const auto = await browserChecks();
      const manual = Object.entries(answers)
        .filter(([id]) => !BROWSER_CHECKS.has(id))
        .map(([id, status]) => ({ id, status, detail: "Self-reported in the browser" }));
      const r = await reportWeb({ checks: [...auto, ...manual], idempotency_key: crypto.randomUUID() });
      setMsg(r?.ok ? { ok: true, text: "Saved. The list above shows the latest answer for each check." } : { ok: false, text: r?.error ?? "Couldn’t save." });
    });
  }

  const manual = checks.filter((c) => !BROWSER_CHECKS.has(c.id));
  return (
    <div className="space-y-6">
      <p className="font-plex text-sm text-lightgray">
        Run each command in your terminal and tell us what happened. This browser checks Chrome and the event API by itself. Nothing here counts as verified: it’s what you saw.
      </p>
      <ul className="divide-y divide-dashed divide-hairline border-y border-dashed border-hairline">
        {manual.map((c) => (
          <li key={c.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="font-plex text-sm text-bright">{c.label}</p>
              {c.command && <CopyField value={c.command} className="mt-2" />}
            </div>
            <fieldset className="flex flex-wrap gap-1">
              <legend className="sr-only">{c.label}: what happened?</legend>
              {(
                [
                  ["pass", "Works"],
                  ["fail", "Broken"],
                  ["skip", "Not sure"],
                ] as const
              ).map(([v, label]) => {
                const on = answers[c.id] === v;
                return (
                  <label
                    key={v}
                    className={`inline-flex min-h-11 cursor-pointer items-center border px-3 font-plex text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lime ${
                      on ? "border-lime bg-lime-deep text-lime" : "border-hairline text-lightgray hover:text-bright"
                    }`}
                  >
                    <input type="radio" name={`r-${c.id}`} value={v} checked={on} onChange={() => setAnswers((a) => ({ ...a, [c.id]: v }))} className="sr-only" />
                    {label}
                  </label>
                );
              })}
            </fieldset>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={submit} disabled={pending} className="min-h-11 bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:opacity-60">
          {pending ? "Checking…" : "Run browser checks and save"}
        </button>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`font-plex text-sm ${msg.ok ? "text-bright" : "text-danger"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
