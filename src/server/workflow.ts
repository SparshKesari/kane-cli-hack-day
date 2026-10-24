import "server-only";
import { query } from "@/lib/db";
import initialOwners from "@/data/hack-os-owners.json";
import { WORKFLOW_TASKS, type WorkflowTask, type WorkflowStatus } from "@/lib/workflow";
import { hasRole, staffActor, type Staff } from "./auth";
import { AppError, parse, withAudit, z } from "./core";

type Stored = { task_id: string; owner_name: string; status: WorkflowStatus; note: string; revision: number; updated_by: string | null; updated_at: Date };
const authorize = (staff: Staff) => { if (!hasRole(staff, "organizer")) throw new AppError("FORBIDDEN"); };
export async function listWorkflowTasks(staff: Staff): Promise<WorkflowTask[]> {
  authorize(staff);
  const [rows, events] = await Promise.all([
    query<Stored>("select task_id, owner_name, status, note, revision, updated_by, updated_at from workflow_ownership where event_id = current_event_id()"),
    query<{ slug: string }>("select slug from hack_events where id = current_event_id()"),
  ]);
  const defaults = new Map((events[0]?.slug === initialOwners.event_slug ? initialOwners.assignments : []).map(row => [row.id, row]));
  const stored = new Map(rows.map(row => [row.task_id, row]));
  return WORKFLOW_TASKS.map(task => {
    const row = stored.get(task.id);
    const initial = defaults.get(task.id);
    return { ...task, owner_name: row?.owner_name ?? initial?.owner_name ?? "", status: row?.status ?? (initial?.status as WorkflowStatus | undefined) ?? "pending", note: row?.note ?? initial?.note ?? "", revision: row?.revision ?? 0, updated_by: row?.updated_by ?? null, updated_at: row ? new Date(row.updated_at).toISOString() : null };
  });
}
const inputSchema = z.object({
  task_id: z.string().refine(id => WORKFLOW_TASKS.some(task => task.id === id), "Unknown workflow task"),
  owner_name: z.string().trim().max(80).transform(value => value.replace(/\s+/g, " ")),
  status: z.enum(["pending", "in_progress", "blocked", "done"]),
  note: z.string().trim().max(1200),
  expected_revision: z.coerce.number().int().min(0),
});
export async function saveWorkflowTask(input: unknown, staff: Staff) {
  authorize(staff);
  const data = parse(inputSchema, input);
  return withAudit(staffActor(staff), "workflow.assign", "workflow_task", async tx => {
    const { rows: events } = await tx.query<{ id: number }>("select current_event_id() as id");
    const eventId = events[0]?.id;
    if (!eventId) throw new AppError("NOT_FOUND");
    await tx.query("insert into workflow_ownership (event_id, task_id) values ($1,$2) on conflict do nothing", [eventId, data.task_id]);
    const { rows } = await tx.query<Stored>("select * from workflow_ownership where event_id=$1 and task_id=$2 for update", [eventId, data.task_id]);
    const before = rows[0];
    if (before.revision !== data.expected_revision) throw new AppError("CONFLICT", { userMessage: "Another organizer changed this task. Refresh the tracker before saving your changes." });
    const { rows: saved } = await tx.query<Stored>(
      "update workflow_ownership set owner_name=$3, status=$4, note=$5, revision=revision+1, updated_by=$6, updated_at=now() where event_id=$1 and task_id=$2 returning *",
      [eventId, data.task_id, data.owner_name, data.status, data.note, staff.name],
    );
    const row = saved[0];
    return { result: { id: `${eventId}:${data.task_id}:${row.revision}`, server_time: new Date(row.updated_at).toISOString() }, resourceId: `${eventId}:${data.task_id}`, before, after: row, reason: "Workflow ownership or readiness updated" };
  });
}
