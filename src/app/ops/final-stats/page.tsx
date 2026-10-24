import type { Metadata } from "next";
import { getFinalStats } from "@/server/final-stats";
import { OpsPage, Panel, SectionLabel, StaffGate } from "../_kit/shell";
import { ImportForm, StatsTable } from "./parts";

export const metadata: Metadata = { title: "Final stats", robots: { index: false } };

// The event's final Kane CLI numbers, imported once after submissions close. An organizer
// downloads latest.json and emails.json from the Kane CLI usage page and uploads both here; the
// server keeps participants' orgs only and saves counts (never emails). /dashboard then shows a
// "Final numbers" panel. Uploading again replaces the saved numbers.

export default function FinalStatsPage() {
  return (
    <OpsPage
      eyebrow="Final stats"
      dim="Kane CLI usage,"
      bright="participants only."
      intro="Upload the usage page's two files once, after submissions close. Check first; saving puts the numbers on /dashboard."
    >
      <StaffGate roles={["organizer"]} next="/ops/final-stats">
        {async () => {
          const saved = await getFinalStats();
          return (
            <div className="space-y-14">
              <section>
                <SectionLabel id="saved">Saved numbers</SectionLabel>
                <Panel>{saved ? <StatsTable stats={saved} /> : <p className="font-plex text-sm text-lightgray">Nothing saved yet. /dashboard shows no final numbers until you save.</p>}</Panel>
              </section>
              <section>
                <SectionLabel id="import" aside="organizer only · audited">
                  Import
                </SectionLabel>
                <Panel>
                  <p className="mb-4 font-plex text-sm text-lightgray">
                    Download both files from the Kane CLI usage page (latest.json from /data/latest.json, emails.json from /emails.json) and choose them below. An org counts when a participant
                    claimed into it or was added to it through the team sync, or when every user in it is a participant. Emails are only matched, never saved.
                  </p>
                  <ImportForm />
                </Panel>
              </section>
            </div>
          );
        }}
      </StaffGate>
    </OpsPage>
  );
}
