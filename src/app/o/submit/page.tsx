import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { onlineEvent } from "@/data/online";
import { teamPrefix } from "@/lib/online/attachment-rules";
import { listAttachments } from "@/lib/online/attachments";
import { emailsOn } from "@/lib/online/email";
import { FIELDS, emptyDraft, formatWhen, getSubmission, isLocked } from "@/lib/online/submission";
import { getMe, getTeam } from "@/lib/online/team";
import Steps from "../Steps";
import TeamTabs from "../TeamTabs";
import SubmitForm from "./SubmitForm";

export const metadata: Metadata = { title: "Submit" };

// Step 4: the team's submission. Anyone on the team can edit it.
export default function OnlineSubmit() {
  return (
    <section className="container-page max-w-2xl py-16">
      <Steps current={4} />
      <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading your submission…</p>}>
        <SubmitBody />
      </Suspense>
    </section>
  );
}

async function SubmitBody() {
  const me = await getMe();
  if (!me) redirect("/o/login");
  const team = me.teamId === null ? null : await getTeam(me.teamId);
  if (!team) redirect("/o/team");
  const [sub, files] = await Promise.all([getSubmission(team.id), listAttachments(team.id)]);
  const locked = isLocked();
  const submitted = sub?.status === "submitted";

  return (
    <>
      <div className="mb-8">
        <TeamTabs slug={team.slug} current="submission" />
      </div>
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">
        {team.solo ? "Solo" : "Team"} · {team.name}
      </p>
      <h1 className="mt-3 font-display text-4xl text-bright sm:text-5xl">Submit your project</h1>
      {submitted ? (
        <div className="mt-6 border border-lime p-5">
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">Submission received</p>
          <dl className="mt-4 grid gap-4 font-plex text-sm sm:grid-cols-3">
            <div>
              <dt className="text-lightgray">Receipt</dt>
              <dd className="mt-1 font-dots text-2xl font-black text-bright">{sub.receipt_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-lightgray">First submitted</dt>
              <dd className="mt-1 text-bright">{sub.submitted_at ? formatWhen(sub.submitted_at) : "—"}</dd>
            </div>
            <div>
              <dt className="text-lightgray">Last saved</dt>
              <dd className="mt-1 text-bright">
                {formatWhen(sub.updated_at)}
                {sub.editor && <span className="block text-lightgray">by {sub.editor}</span>}
              </dd>
            </div>
          </dl>
          <p className="mt-4 font-plex text-sm text-lightgray">
            {emailsOn() ? "A copy went to everyone on the team by email. " : "Keep this receipt code: it's your proof of submission. "}
            {locked ? "Submissions are closed." : `You can keep updating it until ${onlineEvent.deadlineLabel}.`}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-px border border-hairline bg-hairline sm:grid-cols-2">
          <div className="bg-ink p-4">
            <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Status</p>
            <p className="mt-1 font-display text-lg text-bright">Not submitted yet</p>
            {sub && (
              <p className="font-plex text-xs text-lightgray">
                Draft saved {formatWhen(sub.updated_at)}
                {sub.editor ? ` by ${sub.editor}` : ""}
              </p>
            )}
          </div>
          <div className="bg-ink p-4">
            <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">{locked ? "Deadline passed" : "Submit by"}</p>
            <p className="mt-1 font-display text-lg text-bright">{locked ? "Submissions are closed" : onlineEvent.deadlineLabel}</p>
          </div>
        </div>
      )}
      <p className="mt-5 font-plex text-sm leading-relaxed text-lightgray">
        Fields marked <span className="text-lime">*</span> are needed to submit. Save a draft any time. Anyone on your team can edit this; if two of you edit at once, the second save is stopped so nothing is overwritten. Need the Kane CLI setup again?{" "}
        <Link href="/o/start" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
          Open the guide
        </Link>
        .
      </p>
      <div className="mt-10">
        <SubmitForm
          key={sub?.version ?? 0}
          version={sub?.version ?? 0}
          draft={sub ? Object.fromEntries(FIELDS.map((f) => [f, sub[f]])) : emptyDraft()} submitted={submitted} disabled={locked} defaultName={team.solo ? team.name : ""} showcaseHref={`/o/p/${team.slug}`}
          attachments={files.map(({ id, filename, size_bytes }) => ({ id, filename, size_bytes }))}
          uploadPrefix={teamPrefix(team.id)}
        />
      </div>
    </>
  );
}
