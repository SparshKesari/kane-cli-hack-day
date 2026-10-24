import type { Metadata } from "next";
import QR from "@/components/ui/QR";
import { siteUrl } from "@/server/core";
import PrintButton from "../../../_kit/PrintButton";
import { PrintPage, StaffGate } from "../../../_kit/shell";
import { printValues } from "../values";

export const metadata: Metadata = { title: "QR signage", robots: { index: false } };

// QR posters for the room (T-FB-05), one per page. Each QR is a plain URL
// (no tokens, no PII) and the short URL is printed under it for anyone
// without a camera.

const POSTERS = [
  { path: "/activate", eyebrow: "Start here", title: "Activate your Hacker Passport", body: "Your personal passport is separate from team registration. Selfie and photo permissions are optional and separate. Stuck? The check-in desk can do it with you." },
  { path: "/help", eyebrow: "Stuck?", title: "Get a mentor", body: "Open a help ticket: category, table, one sentence. Never paste passwords, tokens or secret logs. If this page is down, take a paper ticket at the help desk." },
  { path: "/match", eyebrow: "Looking for a team?", title: "Team finder", body: "Share your skills and interests only if you want to be discoverable. Teams choose whom to invite. Teams are due at {teamLock}." },
  { path: "/live", eyebrow: "Mission Control", title: "Live clock and announcements", body: "The official submission clock. If the screen says STALE, submissions are still due {lock}." },
] as const;

export default function SignagePage() {
  return (
    <PrintPage title="QR signage">
      <StaffGate roles={["organizer", "mentor"]} next="/ops/recovery/print/signage">
        {async () => {
          const v = await printValues();
          return (
            <div className="space-y-6">
              <div className="no-print">
                <PrintButton label="Print all posters" />
              </div>
              {POSTERS.map((p) => {
                const url = siteUrl(p.path);
                return (
                  <article key={p.path} className="print-paper print-break flex min-h-[80vh] flex-col justify-between border border-hairline p-8 sm:p-12">
                    <div>
                      <p className="font-pixel text-xs uppercase tracking-[0.25em] text-lightgray">
                        {v.eventName} · {p.eyebrow}
                      </p>
                      <h2 className="mt-6 font-display text-5xl leading-[1.05] font-bold text-bright sm:text-6xl">{p.title}</h2>
                      <p className="mt-6 max-w-2xl font-plex text-base leading-relaxed text-lightgray">{p.body.replace("{teamLock}", v.teamLock).replace("{lock}", v.lock)}</p>
                    </div>
                    <div className="mt-10 flex flex-wrap items-end justify-between gap-8">
                      <QR value={url} size={320} label={`QR code: ${p.title}`} caption={url.replace(/^https:\/\//, "")} />
                      <div className="font-plex text-sm text-lightgray">
                        {v.wifi && (
                          <p>
                            Wi-Fi <span className="text-bright">{v.wifi}</span>
                          </p>
                        )}
                        <p>
                          Submissions due <span className="text-bright">{v.lock}</span>
                        </p>
                        {v.helpContact && (
                          <p>
                            Help <span className="text-bright">{v.helpContact}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          );
        }}
      </StaffGate>
    </PrintPage>
  );
}
