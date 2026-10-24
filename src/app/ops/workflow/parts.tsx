"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label, inputCls } from "@/components/forms/fields";
import { WORKFLOW_STAGES, WORKFLOW_STATUSES, ownerKey, ownerSummary, type WorkflowTask } from "@/lib/workflow";
import ActionForm from "../_kit/ActionForm";
import { saveWorkflowAction } from "./actions";

export default function WorkflowBoard({ tasks }: { tasks: WorkflowTask[] }) {
  const [owner, setOwner] = useState("all");
  const [status, setStatus] = useState("pending_all");
  const [stage, setStage] = useState("all");
  const router = useRouter();
  const summaries = ownerSummary(tasks);
  const visible = tasks.filter(task => (owner === "all" || (owner === "unassigned" ? !ownerKey(task.owner_name) : `name:${ownerKey(task.owner_name)}` === owner)) && (status === "all" || (status === "pending_all" ? task.status !== "done" : task.status === status)) && (stage === "all" || task.stage_id === stage));
  return <div className="space-y-8">
    <div className="grid gap-3 sm:grid-cols-3">
      {[["Pending", tasks.filter(task => task.status !== "done").length], ["Blocked", tasks.filter(task => task.status === "blocked").length], ["Unassigned pending", tasks.filter(task => task.status !== "done" && !ownerKey(task.owner_name)).length]].map(([label, count]) => <div key={label} className="border border-hairline bg-surface p-4"><p className="font-plex text-xs text-lightgray">{label}</p><p className="mt-2 font-dots text-4xl text-bright">{count}</p></div>)}
    </div>
    <p className="font-plex text-sm text-lightgray">Initial assignments use the approved planning snapshot; saved event-database edits take precedence. A readiness status does not change participant submission or eligibility.</p>
    <div className="overflow-x-auto"><table className="w-full text-left font-plex text-sm"><caption className="mb-3 text-left font-display text-lg text-bright">What is pending on whom</caption><thead className="text-lightgray"><tr><th scope="col" className="p-3">Owner</th><th scope="col" className="p-3">Pending</th><th scope="col" className="p-3">Blocked</th><th scope="col" className="p-3">Done</th></tr></thead><tbody>{summaries.map(row => <tr key={row.key} className="border-t border-hairline"><th scope="row" className="p-3 font-normal"><button type="button" onClick={() => { setOwner(row.key ? `name:${row.key}` : "unassigned"); setStatus("pending_all"); setStage("all"); }} className="min-h-11 text-bright underline hover:text-lime">{row.name}</button></th><td className="p-3">{row.pending}</td><td className="p-3">{row.blocked}</td><td className="p-3">{row.done}</td></tr>)}</tbody></table></div>
    <div className="grid items-end gap-4 sm:grid-cols-4">
      <div><Label htmlFor="filter-owner">Owner</Label><select id="filter-owner" value={owner} onChange={e => setOwner(e.target.value)} className={inputCls}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{summaries.filter(row => row.key).map(row => <option key={row.key} value={`name:${row.key}`}>{row.name}</option>)}</select></div>
      <div><Label htmlFor="filter-status">Status</Label><select id="filter-status" value={status} onChange={e => setStatus(e.target.value)} className={inputCls}><option value="pending_all">All pending work</option><option value="all">All statuses</option>{Object.entries(WORKFLOW_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div><Label htmlFor="filter-stage">Workflow step</Label><select id="filter-stage" value={stage} onChange={e => setStage(e.target.value)} className={inputCls}><option value="all">Entire workflow</option>{WORKFLOW_STAGES.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></div>
      <button type="button" onClick={() => router.refresh()} className="min-h-11 border border-hairline px-4 font-plex text-sm text-bright hover:border-lime">Refresh shared changes</button>
    </div>
    <p role="status" className="font-plex text-sm text-lightgray">{visible.length} of {tasks.length} tasks shown.</p>
    <datalist id="workflow-owner-names">{summaries.filter(row => row.key).map(row => <option key={row.key} value={row.name} />)}</datalist>
    {WORKFLOW_STAGES.map(step => {
      const rows = visible.filter(task => task.stage_id === step.id);
      if (!rows.length) return null;
      return <section key={step.id} aria-labelledby={`stage-${step.id}`} className="space-y-4">
        <h2 id={`stage-${step.id}`} className="font-display text-2xl text-bright">{step.title}</h2>
        <details className="border border-hairline p-4 font-plex text-sm text-lightgray"><summary className="cursor-pointer text-bright">Participant / skill / backend context</summary><dl className="mt-4 grid gap-4 md:grid-cols-3">{[["Participant",step.participant],["Skill",step.skill],["Backend",step.backend]].map(([label,text]) => <div key={label}><dt className="mb-2 text-lime">{label}</dt><dd>{text}</dd></div>)}</dl><p className="mt-4">{step.note}</p></details>
        {rows.map(task => <article key={`${task.id}:${task.revision}`} className="border border-hairline bg-surface p-4 sm:p-6"><div className="mb-4"><p className="font-plex text-xs text-warning">{task.dependency} · {WORKFLOW_STATUSES[task.status]}</p><h3 className="mt-2 font-display text-lg text-bright">{task.title}</h3><p className="mt-2 font-plex text-sm text-lightgray">{task.acceptance}</p></div>
          <ActionForm action={saveWorkflowAction} submit="Save owner and status" pending="Saving…" variant="secondary">
            {state => <>
            <input type="hidden" name="task_id" value={task.id} /><input type="hidden" name="expected_revision" value={task.revision} />
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`${task.id}-owner`} hint="blank = unassigned">Owner name</Label><input id={`${task.id}-owner`} name="owner_name" defaultValue={state?.values?.owner_name ?? task.owner_name} maxLength={80} list="workflow-owner-names" placeholder="Enter a name" className={inputCls} /></div><div><Label htmlFor={`${task.id}-status`}>Status</Label><select id={`${task.id}-status`} name="status" defaultValue={state?.values?.status ?? task.status} className={inputCls}>{Object.entries(WORKFLOW_STATUSES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
            <div><Label htmlFor={`${task.id}-note`}>Blocker / next action</Label><textarea id={`${task.id}-note`} name="note" defaultValue={state?.values?.note ?? task.note} rows={2} maxLength={1200} placeholder="What is needed next?" className={inputCls} /></div>
          </>}
          </ActionForm>
          {task.updated_at && <p className="mt-3 font-plex text-xs text-lightgray">Last saved by {task.updated_by ?? "organizer"} · {new Date(task.updated_at).toLocaleString("en-US",{timeZone:"America/Los_Angeles",timeZoneName:"short"})}</p>}
        </article>)}
      </section>;
    })}
    {!visible.length && <p className="border border-hairline p-6 font-plex text-sm text-lightgray">No tasks match these filters. Choose all owners or all statuses to see the rest.</p>}
  </div>;
}
