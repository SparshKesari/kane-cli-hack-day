import catalog from "@/data/hack-os-tasks.json";
import workflow from "@/data/hack-os-workflow.json";

export const WORKFLOW_STATUSES = { pending: "Pending", in_progress: "In progress", blocked: "Blocked", done: "Done" } as const;
export type WorkflowStatus = keyof typeof WORKFLOW_STATUSES;
export type WorkflowTask = (typeof catalog)[number] & {
  owner_name: string; status: WorkflowStatus; note: string; revision: number;
  updated_by: string | null; updated_at: string | null;
};
export const WORKFLOW_TASKS = catalog;
export const WORKFLOW_STAGES = workflow.stages;
export const ownerKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

export function ownerSummary(tasks: WorkflowTask[]) {
  const groups = new Map<string, { key: string; name: string; total: number; pending: number; blocked: number; done: number }>();
  for (const task of tasks) {
    const key = ownerKey(task.owner_name);
    const row = groups.get(key) ?? { key, name: task.owner_name || "Unassigned", total: 0, pending: 0, blocked: 0, done: 0 };
    row.total++; if (task.status === "done") row.done++; else row.pending++;
    if (task.status === "blocked") row.blocked++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a,b) => !a.key ? -1 : !b.key ? 1 : a.name.localeCompare(b.name));
}
