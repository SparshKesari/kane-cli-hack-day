"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { FormError, Label, SubmitButton, inputCls } from "@/components/forms/fields";
import { defectAction, logManualRun, milestoneDecision, proposeMilestoneAction, type ProofFormState } from "./actions";
import { apiFetch } from "@/lib/api-client";

// Client forms for the Proof tab. Success text appears only after the server
// returns a receipt, in an aria-live region.

function Done({ state }: { state: ProofFormState }) {
  return (
    <div aria-live="polite" className="min-h-0">
      {state?.ok && <p className="border-l-2 border-lime pl-3 font-plex text-sm text-bright">{state.ok}</p>}
      <FormError message={state?.error} />
    </div>
  );
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function ManualRunForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<ProofFormState, FormData>(logManualRun.bind(null, slug), null);
  const [key] = useState(newKey);
  const id = useId();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="idempotency_key" value={key} />
      <div>
        <Label htmlFor={`${id}-url`} hint="https only">
          Kane report link
        </Label>
        <input id={`${id}-url`} name="report_url" type="url" required inputMode="url" placeholder="https://test-manager.lambdatest.com/…" className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div>
          <Label htmlFor={`${id}-exit`}>Exit code</Label>
          <select id={`${id}-exit`} name="exit_code" required defaultValue="" className={inputCls}>
            <option value="" disabled>
              Pick
            </option>
            <option value="0">0 passed</option>
            <option value="1">1 failed</option>
            <option value="2">2 didn’t run</option>
            <option value="3">3 timed out</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-sha`} hint="optional">
            Commit SHA (40 chars)
          </Label>
          <input id={`${id}-sha`} name="commit_sha" pattern="[0-9a-fA-F]{40}" placeholder="git rev-parse HEAD" className={inputCls} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-run`} hint="optional">
            Run / session id
          </Label>
          <input id={`${id}-run`} name="run_id" maxLength={120} className={inputCls} />
        </div>
        <div>
          <Label htmlFor={`${id}-obj`} hint="optional">
            What it checked
          </Label>
          <input id={`${id}-obj`} name="objective" maxLength={500} className={inputCls} />
        </div>
      </div>
      <Done state={state} />
      <SubmitButton pending="Saving…" className="min-h-11">
        Log run (unverified)
      </SubmitButton>
    </form>
  );
}

export function DefectButtons({ slug, defectId, status }: { slug: string; defectId: number; status: string }) {
  const [state, action] = useActionState<ProofFormState, FormData>(defectAction.bind(null, slug), null);
  const buttons: { action: string; label: string; primary?: boolean }[] =
    status === "suspected"
      ? [
          { action: "confirm", label: "Confirm it’s a real bug", primary: true },
          { action: "not_a_bug", label: "Not a bug" },
        ]
      : status === "confirmed"
        ? [
            { action: "mark_fixed", label: "We fixed it (re-run to verify)", primary: true },
            { action: "not_a_bug", label: "Not a bug" },
          ]
        : [{ action: "reopen", label: "Reopen" }];
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="defect_id" value={defectId} />
      {status === "suspected" && (
        <label className="flex min-h-11 items-center gap-2 font-plex text-xs text-lightgray">
          Cause
          <select name="failure_class" defaultValue="product" className="border border-hairline bg-surface px-2 py-1.5 text-bright">
            <option value="product">Product bug</option>
            <option value="infra">Infra / setup</option>
            <option value="auth">Auth</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.action}
            type="submit"
            name="action"
            value={b.action}
            className={`min-h-11 px-3 py-2 font-plex text-xs transition-colors ${b.primary ? "bg-bright text-ink hover:bg-lime" : "border border-hairline text-bright hover:border-lime hover:text-lime"}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <Done state={state} />
    </form>
  );
}

export function MilestoneForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<ProofFormState, FormData>(proposeMilestoneAction.bind(null, slug), null);
  const [key] = useState(newKey);
  const id = useId();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="idempotency_key" value={key} />
      <div>
        <Label htmlFor={`${id}-t`}>Milestone</Label>
        <input id={`${id}-t`} name="title" required maxLength={120} placeholder="Checkout flow passes on every PR" className={inputCls} />
      </div>
      <div>
        <Label htmlFor={`${id}-c`}>The claim, in one or two sentences</Label>
        <textarea id={`${id}-c`} name="claim" required maxLength={600} rows={3} className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-r`} hint="KR-…">
            Backing run
          </Label>
          <input id={`${id}-r`} name="source_run_id" placeholder="KR-12" className={inputCls} />
        </div>
        <div>
          <Label htmlFor={`${id}-e`} hint="EV-…, comma separated">
            Evidence
          </Label>
          <input id={`${id}-e`} name="evidence_ids" placeholder="EV-3, EV-4" className={inputCls} />
        </div>
        <div>
          <Label htmlFor={`${id}-v`}>Who can see it</Label>
          <select id={`${id}-v`} name="visibility" defaultValue="team" className={inputCls}>
            <option value="team">Team only</option>
            <option value="judges">Judges (teammate approves)</option>
            <option value="public">Public (teammate approves)</option>
          </select>
        </div>
      </div>
      <p className="font-plex text-xs text-lightgray">Confidence is set by the server: VERIFIED only when a source-verified run or its evidence backs the claim.</p>
      <Done state={state} />
      <SubmitButton pending="Proposing…" className="min-h-11">
        Propose milestone
      </SubmitButton>
    </form>
  );
}

export function MilestoneButtons({ slug, id, canApprove, label }: { slug: string; id: number; canApprove: boolean; label: string }) {
  const [aState, approve] = useActionState<ProofFormState, FormData>(milestoneDecision.bind(null, slug, id, "approve"), null);
  const [wState, withdraw] = useActionState<ProofFormState, FormData>(milestoneDecision.bind(null, slug, id, "withdraw"), null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <form action={approve}>
            <button type="submit" className="min-h-11 bg-bright px-3 py-2 font-plex text-xs text-ink transition-colors hover:bg-lime">
              Approve {label}
            </button>
          </form>
        )}
        <form action={withdraw}>
          <button type="submit" className="min-h-11 border border-hairline px-3 py-2 font-plex text-xs text-bright transition-colors hover:border-lime hover:text-lime">
            Withdraw
          </button>
        </form>
      </div>
      <Done state={aState ?? wState} />
    </div>
  );
}

const KINDS = [
  ["ndjson", "Kane NDJSON output"],
  ["screenshot", "Screenshot"],
  ["video", "Video"],
  ["report", "Report (pdf/json/md/html)"],
  ["testmd", "_test.md file"],
  ["zip", "Evidence pack (.evidence/.zip)"],
  ["log", "Log"],
] as const;

const DIRECT_MAX = 4 * 1024 * 1024;
/** Browsers give a Kane `.evidence` pack no content type, and the signed upload only allows listed types. */
const KANE_PACK = /\.evidence$/i;
const KANE_PACK_TYPE = "application/zip";

/**
 * Evidence upload. Up to 4 MB goes straight to /api/v1/kane/evidence; larger
 * files go to Blob with a signed token first and are checked server-side
 * before they count. Nothing is shown as stored until the server answers.
 */
export function EvidenceUpload({ projectId, runs }: { projectId: number; runs: { id: number; label: string }[] }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setMsg({ error: "Choose a file." });
    setBusy(true);
    setMsg(null);
    try {
      let res: Response;
      if (file.size <= DIRECT_MAX) {
        form.set("project_id", String(projectId));
        res = await apiFetch("/api/v1/kane/evidence", { method: "POST", body: form });
      } else {
        const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
        const blob = await upload(`evidence-incoming/${projectId}/${safe}`, file, {
          access: "private",
          handleUploadUrl: "/api/v1/kane/evidence/upload",
          contentType: KANE_PACK.test(file.name) ? KANE_PACK_TYPE : undefined,
        });
        res = await apiFetch("/api/v1/kane/evidence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pathname: blob.pathname, name: file.name, kind: form.get("kind"), run_id: form.get("run_id") || undefined, project_id: projectId, visibility: form.get("visibility") }),
        });
      }
      const env = (await res.json().catch(() => null)) as { message?: string; status?: string } | null;
      if (!res.ok || !env || env.status === "error") setMsg({ error: env?.message ?? "Upload failed. Keep the file and try again." });
      else {
        setMsg({ ok: env.message });
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch {
      setMsg({ error: "Upload failed. Keep the file and try again, or show it to a mentor." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-k`}>Kind</Label>
          <select id={`${id}-k`} name="kind" required defaultValue="ndjson" className={inputCls}>
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-r`} hint="optional">
            Backs run
          </Label>
          <select id={`${id}-r`} name="run_id" defaultValue="" className={inputCls}>
            <option value="">None</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div>
          <Label htmlFor={`${id}-f`} hint="max 50 MB">
            File
          </Label>
          <input id={`${id}-f`} name="file" type="file" required className={`${inputCls} file:mr-3 file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-bright`} />
        </div>
        <div>
          <Label htmlFor={`${id}-v`}>Visible to</Label>
          <select id={`${id}-v`} name="visibility" defaultValue="team" className={inputCls}>
            <option value="team">Team</option>
            <option value="judges">Team + judges</option>
          </select>
        </div>
      </div>
      <p className="font-plex text-xs text-lightgray">Files are private. Executables, zip bombs and path tricks are quarantined. Don’t upload secrets or .env files.</p>
      <div aria-live="polite">
        {msg?.ok && <p className="border-l-2 border-lime pl-3 font-plex text-sm text-bright">{msg.ok}</p>}
        <FormError message={msg?.error} />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center bg-bright px-4 py-2.5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Upload evidence"}
      </button>
    </form>
  );
}
