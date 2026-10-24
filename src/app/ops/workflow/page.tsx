import type { Metadata } from "next";
import Link from "next/link";
import { listWorkflowTasks } from "@/server/workflow";
import { OpsPage, StaffGate } from "../_kit/shell";
import WorkflowBoard from "./parts";

export const metadata: Metadata = { title: "Workflow owners", robots: { index: false } };
export default function WorkflowPage() {
  return <OpsPage eyebrow="Workflow owners" dim="Every gap," bright="A clear owner." intro="Assign names, track blockers and see what is pending for each person. Saved assignments are shared across organizers.">
    <StaffGate roles={["organizer"]} next="/ops/workflow">{async staff => {
      let tasks;
      try { tasks = await listWorkflowTasks(staff); }
      catch (error) {
        if ((error as { code?: string }).code !== "42P01") throw error;
        return <p role="alert" className="border border-warning p-4 font-plex text-sm text-warning">Owner tracking is not initialized. Apply database migration 034_workflow_ownership.sql, then refresh this page.</p>;
      }
      return <div className="space-y-6"><p className="font-plex text-sm text-lightgray"><Link href="/hack-os-flow.html" className="underline hover:text-lime">Open the participant / skill / backend diagram →</Link></p><WorkflowBoard tasks={tasks} /></div>;
    }}</StaffGate>
  </OpsPage>;
}
