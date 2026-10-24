import "server-only";
import { query } from "@/lib/db";
import { looksLikeMetric, type PublicStory } from "@/components/ship-templates/model";
import { draftObject } from "./ai";
import { AppError, idempotent, parse, serverNow, siteUrl, withAudit, z, type Receipt } from "./core";
import { getLatestPublished, previewStory, requireWrite, type ProjectAccess } from "./story";

// GTM kit (T-GTM-01..04) and the 60-second video storyboard (T-VID-01..03).
// Everything is generated from the reviewed story, flagged claim by claim,
// and stays a draft until a team member approves it. Nothing here posts
// anywhere: copying and posting is a human act.
//
// LLM drafts go through draftObject (AI Gateway) with a deterministic
// template fallback from GTM_COPY_TEMPLATES.md, so the kit works offline.

// ── Kit shape ────────────────────────────────────────────────────────────────

export const kitDraftSchema = z.object({
  x_post: z.string().max(400),
  thread: z.array(z.string().max(400)).length(4),
  readme: z.string().max(4000),
  alt_text: z.string().max(400),
  og_title: z.string().max(90),
  og_description: z.string().max(220),
  pitch: z.string().max(400),
});
export type KitDraft = z.infer<typeof kitDraftSchema>;

export type ClaimFlag = { text: string; confidence: "verified" | "participant_reported" | "unverified" | "qualitative" | "measured"; ref: string | null };
export type CopyCheck = { field: string; level: "block" | "warn"; message: string };

export type GtmKit = {
  id: number | null;
  storyVersion: number;
  draft: KitDraft;
  generator: "llm" | "rules" | "human";
  model: string | null;
  status: "draft" | "approved" | "superseded";
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string | null;
  claims: ClaimFlag[];
  checks: CopyCheck[];
  /** True only when the Ship Page is published and no check blocks. */
  shareable: boolean;
  shipUrl: string | null;
  warning?: string;
};

const PLACEHOLDER_LINK = "[Ship Page: publish it first]";

/** The claims the copy may lean on, each with its confidence. Computed from the story, not by the LLM. */
export function claimFlags(story: PublicStory): ClaimFlag[] {
  return [
    ...story.proof.map((p) => ({
      text: p.claim,
      confidence: (p.run && p.run.status !== "passed" && p.confidence === "verified" ? "unverified" : p.confidence) as ClaimFlag["confidence"],
      ref: p.run_id ? `run ${p.run_id}` : p.evidence_id ? `evidence ${p.evidence_id}` : p.source || null,
    })),
    ...story.impact.map((i) => ({
      text: i.measured ? `${i.claim} (${i.measure}${i.unit ? " " + i.unit : ""} vs baseline ${i.baseline})` : i.claim,
      confidence: (i.measured ? "measured" : "qualitative") as ClaimFlag["confidence"],
      ref: i.source,
    })),
  ];
}

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

/**
 * Guard the copy (T-GTM-03): links must be the repo, demo or a *published*
 * Ship Page; numbers must come from verified proof or measured impact; X post
 * length. Returns the cleaned draft and the checks.
 */
export function guardCopy(draft: KitDraft, story: PublicStory, shipPublished: boolean): { draft: KitDraft; checks: CopyCheck[] } {
  const checks: CopyCheck[] = [];
  const ship = story.links.shipPage;
  const allowed = new Set([story.links.github, story.links.demo, story.links.repoCommit].filter((x): x is string => !!x && x.startsWith("https://")));
  if (shipPublished) allowed.add(ship);
  const deckUrl = `${ship}/deck`;
  if (shipPublished && story.hasDeck) allowed.add(deckUrl);

  const verifiedNumbers = new Set<string>();
  for (const p of story.proof) if (p.confidence === "verified") for (const m of p.claim.match(/\d[\d,.]*/g) ?? []) verifiedNumbers.add(m);
  for (const i of story.impact) if (i.measured) [i.measure, i.baseline].forEach((n) => n !== null && verifiedNumbers.add(String(n)));

  const clean = (field: string, text: string) => {
    let t = text.replace(URL_RE, (u) => {
      const url = u.replace(/[.,;:!?]+$/, "");
      if (allowed.has(url)) return u;
      if (url.startsWith(ship)) {
        checks.push({ field, level: "block", message: "Linked the Ship Page before it is published. Publish it, then regenerate." });
        return PLACEHOLDER_LINK;
      }
      checks.push({ field, level: "warn", message: `Removed a link that isn't the repo, demo or Ship Page: ${url.slice(0, 60)}` });
      return "[link removed]";
    });
    if (!shipPublished && t.includes(ship)) t = t.split(ship).join(PLACEHOLDER_LINK);
    if (t.includes(PLACEHOLDER_LINK) && !checks.some((c) => c.field === field && c.level === "block")) {
      checks.push({ field, level: "block", message: "Mentions the Ship Page, which isn't published yet." });
    }
    for (const sentence of t.split(/(?<=[.!?])\s+|\n/)) {
      if (!looksLikeMetric(sentence)) continue;
      const nums = sentence.match(/\d[\d,.]*/g) ?? [];
      if (nums.some((n) => !verifiedNumbers.has(n.replace(/[.,]+$/, "")))) {
        checks.push({ field, level: "block", message: `States a number that isn't verified or measured: “${sentence.trim().slice(0, 60)}”` });
      }
    }
    return t;
  };

  const out: KitDraft = {
    x_post: clean("x_post", draft.x_post),
    thread: draft.thread.map((t, i) => clean(`thread.${i + 1}`, t)) as KitDraft["thread"],
    readme: clean("readme", draft.readme),
    alt_text: clean("alt_text", draft.alt_text),
    og_title: clean("og_title", draft.og_title),
    og_description: clean("og_description", draft.og_description),
    pitch: clean("pitch", draft.pitch),
  };
  if ([...out.x_post].length > 280) checks.push({ field: "x_post", level: "block", message: `X post is ${[...out.x_post].length} characters; the limit is 280.` });
  out.thread.forEach((t, i) => [...t].length > 280 && checks.push({ field: `thread.${i + 1}`, level: "block", message: `Thread post ${i + 1} is over 280 characters.` }));
  if (out.og_title.length > 60) checks.push({ field: "og_title", level: "warn", message: "OG title is over 60 characters; it may be cut off." });
  return { draft: out, checks };
}

// ── Fallback templates (GTM_COPY_TEMPLATES.md) ────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// Names stay capitalized when a phrase continues a sentence: these, the project's own name, and
// words with a capital or digit after the first letter (AI, OpenAI, GitHub, 3D).
const NAMES = new Set(["Kane", "Codex", "OpenAI", "ChatGPT", "GitHub", "TestMu", "LambdaTest", "Chrome", "Slack"]);
const lc = (s: string, keep: string[] = []) => {
  const word = s.match(/^[A-Za-z0-9]+/)?.[0] ?? "";
  return !s || NAMES.has(word) || keep.includes(word) || /[A-Z0-9]/.test(word.slice(1)) ? s : s[0].toLowerCase() + s.slice(1);
};
// Team text usually ends a sentence already; the templates add exactly one mark, never a second.
const sentence = (s: string) => (/[.!?…]$/.test(s.trimEnd()) ? s.trimEnd() : `${s.trimEnd()}.`);
const bare = (s: string) => s.trimEnd().replace(/[.!?]+$/, "");

export function templateKit(story: PublicStory, shipPublished: boolean): KitDraft {
  const link = shipPublished ? story.links.shipPage : PLACEHOLDER_LINK;
  const pitch = story.pitch || story.whatWeBuilt.split(/[.\n]/)[0] || "[ONE CLEAR FUNCTION]";
  const verified = story.proof.find((p) => p.confidence === "verified" && (!p.run || p.run.status === "passed"));
  const harness = story.harness.stages.length ? story.harness.stages.join(" → ") : "[TRIGGER] → [KANE COMPONENT] → [EVIDENCE] → [DECISION]";
  const gap = story.limitations[0] ?? "[LIMITATION]";
  const handles = story.team.map((t) => t.handle).filter(Boolean).map((h) => `@${h}`).join(" ");
  const isHarness = story.creationType === "validation_harness";
  const lower = (s: string) => lc(s, [story.name]);

  const x_post = isHarness
    ? `We didn't build another app. We built the validation layer around one.\n\n${story.name} uses Kane CLI${story.harness.summary ? `: ${sentence(story.harness.summary)}` : " to verify every change."} Demo, evidence and code: ${link}${handles ? `\n\n${handles}` : ""}`
    : `We built ${story.name}: ${sentence(lower(pitch))}\n\nThe interesting part is the Kane-powered validation loop${verified ? ` that ${lower(bare(verified.claim))}` : ""}.\n\nSee the creation, the harness and the actual proof: ${link}${handles ? `\n\n${handles}` : ""}`;

  const thread: KitDraft["thread"] = [
    `The problem: ${sentence(clip(story.problem || "agents can build fast, but knowing what actually works is harder", 200))} Our hackathon project ${story.name} attacks that gap.`,
    `What we created: ${sentence(clip(story.whatWeBuilt || pitch, 200))} Short demo: ${link}`,
    `How the harness works: ${sentence(clip(harness, 200))}`,
    verified
      ? `What we proved: ${clip(bare(verified.claim), 140)} (${verified.run_id ? `Kane run ${verified.run_id}` : `evidence ${verified.evidence_id}`}). Not verified yet: ${sentence(clip(gap, 80))}${story.links.github ? ` Source: ${story.links.github}` : ""}`
      : `What we learned: nothing here is claimed as verified yet. Still open: ${sentence(clip(gap, 120))}${story.links.github ? ` Source: ${story.links.github}` : ""}`,
  ];

  const evidenceLines = story.proof.length
    ? story.proof.map((p) => `- ${p.claim} (${p.confidence.replace("_", " ")}${p.run_id ? `, run ${p.run_id}` : ""}${p.evidence_id ? `, evidence ${p.evidence_id}` : ""})`).join("\n")
    : "- No verified evidence attached yet.";
  const readme = `### ${story.name}

${pitch}

**Problem:** ${story.problem || "[Concrete engineering/product problem]"}

**The creation:** ${story.whatWeBuilt || "[Runnable artifact and scope]"}

**Kane-powered validation:** ${story.harness.summary || "[Real components and why used]"}${story.harness.components.length ? ` (${story.harness.components.join(", ")})` : ""}

**Reproduce it:**
${story.howItWorks.length ? story.howItWorks.map((s, i) => `${i + 1}. ${s}`).join("\n") : "1. [Approved setup steps, version constraints and non-secret env variable names]"}

**Evidence:**
${evidenceLines}

**Limitations:** ${story.limitations.length ? story.limitations.join("; ") : "[What isn't covered yet]"}

**Team and showcase:** ${story.team.map((t) => (t.handle ? `${t.name} (@${t.handle})` : t.name)).join(", ") || "[Consented credits]"} | ${link}
`;
  const visual = story.visuals[0];
  return {
    x_post,
    thread,
    readme,
    alt_text: visual ? `Image of ${bare(visual.alt)} for ${story.name}.` : `Title card for ${story.name}: “${clip(pitch, 90)}” on a black background.`,
    og_title: clip(`${story.name} | Shipped with Kane`, 60),
    og_description: clip(`${story.name}: ${sentence(lower(pitch))} Explore the creation, Kane-powered validation workflow and evidence.`, 200),
    pitch: `We built ${story.name}: ${sentence(lower(pitch))} What makes it different: ${sentence(story.harness.summary || "its Kane validation loop")}`,
  };
}

// ── Generate / save / approve ─────────────────────────────────────────────────

type KitRow = { id: number; story_version: number; content: KitDraft; generator: GtmKit["generator"]; model: string | null; status: GtmKit["status"]; approved_at: Date | null; approved_by_name: string | null; created_at: Date };

async function latestKit(projectId: number) {
  const [r] = await query<KitRow>(
    `select k.id, k.story_version, k.content, k.generator, k.model, k.status, k.approved_at, k.created_at, m.name as approved_by_name
       from gtm_kits k left join members m on m.id = k.approved_by
      where k.project_id = $1 and k.status <> 'superseded' order by k.id desc limit 1`,
    [projectId],
  );
  return r ?? null;
}

/** The current kit for the studio page (the latest saved, else a fresh template draft, not saved). */
export async function getKit(access: ProjectAccess): Promise<GtmKit> {
  const [preview, published, row] = await Promise.all([previewStory(access), getLatestPublished(access.project.id, "ship_page"), latestKit(access.project.id)]);
  const shipPublished = !!published && published.state === "public";
  const base = row?.content ?? templateKit(preview.story, shipPublished);
  const { draft, checks } = guardCopy(base, preview.story, shipPublished);
  return {
    id: row?.id ?? null,
    storyVersion: row?.story_version ?? preview.version,
    draft,
    generator: row?.generator ?? "rules",
    model: row?.model ?? null,
    status: row?.status ?? "draft",
    approvedBy: row?.approved_by_name ?? null,
    approvedAt: row?.approved_at?.toISOString() ?? null,
    createdAt: row?.created_at.toISOString() ?? null,
    claims: claimFlags(preview.story),
    checks: row && row.story_version !== preview.version ? [...checks, { field: "kit", level: "warn", message: `Drafted from story v${row.story_version}; the story is now v${preview.version}. Regenerate to pick up changes.` }] : checks,
    shareable: shipPublished && !checks.some((c) => c.level === "block"),
    shipUrl: shipPublished ? preview.story.links.shipPage : null,
  };
}

const SYSTEM = `You draft launch copy for a hackathon project from its reviewed project story.
Rules (non-negotiable):
- Use ONLY facts in the story JSON. Never invent numbers, percentages, users, testimonials, logos or results.
- A claim with confidence "verified" may be stated as verified. "participant_reported" must read as the team's report. "unverified" must not be claimed as fact.
- Impact numbers may only be used when "measured" is true, with their unit.
- A failing Kane run is a suspected detection, not a confirmed bug and not a pass.
- Links: only the github, demo and shipPage URLs given. If shipPublished is false, write the literal text "${PLACEHOLDER_LINK}" instead of the Ship Page URL.
- X post and each thread post: at most 270 characters. Thread = exactly 4 posts: problem, what we created, how the harness works, what we proved + what isn't verified yet.
- README excerpt in Markdown: what it does, problem, creation, Kane-powered validation, how to run, evidence, limitations, team.
- Alt text describes the actual visual if one is listed; otherwise the title card.
- Plain, specific, no hype words, no emojis, no hashtags except optionally #KaneCLI.`;

/** Draft a new kit (LLM with template fallback), guard it, store it as a draft. */
export async function generateKit(access: ProjectAccess, input: unknown): Promise<{ data: GtmKit; receipt: Receipt }> {
  requireWrite(access);
  const { idempotency_key } = parse(z.object({ idempotency_key: z.string().trim().min(8).max(200).optional() }), input ?? {});
  const [preview, published] = await Promise.all([previewStory(access), getLatestPublished(access.project.id, "ship_page")]);
  if (preview.version === 0) throw new AppError("VALIDATION_FAILED", { userMessage: "Save your story first: the kit is drafted from it." });
  const shipPublished = !!published && published.state === "public";
  const facts = { ...preview.story, shipPublished, preview: undefined, badges: undefined };

  const { result } = await idempotent(idempotency_key, `gtm.generate:project:${access.project.id}`, async () => {
    const drafted = await draftObject({
      schema: kitDraftSchema,
      system: SYSTEM,
      prompt: `Project story (public fields only):\n${JSON.stringify(facts, null, 2)}`,
      fallback: () => templateKit(preview.story, shipPublished),
    });
    const { draft } = guardCopy(drafted.value, preview.story, shipPublished);
    const id = await withAudit(access.actor, "gtm.generate", "gtm_kit", async (tx) => {
      await tx.query("update gtm_kits set status = 'superseded' where project_id = $1 and status = 'draft'", [access.project.id]);
      const { rows } = await tx.query<{ id: number }>(
        `insert into gtm_kits (project_id, story_id, story_version, content, generator, model, created_by)
         values ($1, (select id from project_stories where project_id = $1 and version = $2), $2, $3, $4, $5, $6) returning id`,
        [access.project.id, preview.version, JSON.stringify(draft), drafted.generator, drafted.model, access.member.id],
      );
      return { result: rows[0].id, resourceId: rows[0].id, payload: { generator: drafted.generator, story_version: preview.version } };
    });
    return { id, warning: drafted.warning ?? null };
  });
  const kit = await getKit(access);
  return { data: { ...kit, warning: result.warning ?? undefined }, receipt: { id: `GTM-${result.id}`, server_time: (await serverNow()).toISOString() } };
}

/** Save hand edits as a new draft (generator 'human'). */
export async function saveKit(access: ProjectAccess, input: unknown): Promise<{ data: GtmKit; receipt: Receipt }> {
  requireWrite(access);
  const draft = parse(kitDraftSchema, input);
  const preview = await previewStory(access);
  const published = await getLatestPublished(access.project.id, "ship_page");
  const guarded = guardCopy(draft, preview.story, !!published && published.state === "public");
  const id = await withAudit(access.actor, "gtm.edit", "gtm_kit", async (tx) => {
    await tx.query("update gtm_kits set status = 'superseded' where project_id = $1 and status in ('draft','approved')", [access.project.id]);
    const { rows } = await tx.query<{ id: number }>(
      `insert into gtm_kits (project_id, story_id, story_version, content, generator, created_by)
       values ($1, (select id from project_stories where project_id = $1 and version = $2), $2, $3, 'human', $4) returning id`,
      [access.project.id, preview.version, JSON.stringify(guarded.draft), access.member.id],
    );
    return { result: rows[0].id, resourceId: rows[0].id };
  });
  return { data: await getKit(access), receipt: { id: `GTM-${id}`, server_time: (await serverNow()).toISOString() } };
}

/** Approve the current kit for sharing. Refused while the Ship Page is unpublished or a check blocks (T-GTM-03). */
export async function approveKit(access: ProjectAccess): Promise<{ data: GtmKit; receipt: Receipt }> {
  requireWrite(access);
  const kit = await getKit(access);
  if (!kit.id) throw new AppError("VALIDATION_FAILED", { userMessage: "Generate or save the kit first." });
  if (!kit.shipUrl) throw new AppError("VALIDATION_FAILED", { userMessage: "Publish the Ship Page first: the kit can't link a page nobody can open." });
  const block = kit.checks.find((c) => c.level === "block");
  if (block) throw new AppError("VALIDATION_FAILED", { userMessage: block.message });
  await withAudit(access.actor, "gtm.approve", "gtm_kit", async (tx) => {
    const { rowCount } = await tx.query("update gtm_kits set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft'", [kit.id, access.member.id]);
    if (!rowCount) throw new AppError("CONFLICT", { userMessage: "That kit was already approved or replaced. Reload." });
    return { result: null, resourceId: kit.id!, payload: { story_version: kit.storyVersion } };
  });
  return { data: await getKit(access), receipt: { id: `GTM-${kit.id}-OK`, server_time: (await serverNow()).toISOString() } };
}

// ── Video storyboard (T-VID-01..03) ───────────────────────────────────────────

export const VIDEO_SCENES = [
  { id: "hook", start: 0, end: 6, title: "Name and outcome", hint: "Full-screen project name + outcome, under 12 words." },
  { id: "demo", start: 6, end: 22, title: "See it work", hint: "The actual app / extension / CI / harness running. No generated green results." },
  { id: "kane", start: 22, end: 38, title: "Kane flow", hint: "The real command and verification steps." },
  { id: "evidence", start: 38, end: 52, title: "Evidence", hint: "Run id, screenshot, finding or closed loop. Failures welcome." },
  { id: "impact", start: 52, end: 60, title: "Why it matters", hint: "Impact with its source + Ship Page QR. Small TestMu mark bottom-right." },
] as const;

const footageSchema = z.object({
  kind: z.enum(["none", "upload", "url", "screenshots"]),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((s) => s === "" || /^https:\/\/[^\s"'<>]+$/.test(s), "Footage links must be https://")
    .default(""),
  object_key: z.string().trim().max(300).default(""),
  label: z.string().trim().max(120).default(""),
});

const tc = z.string().trim().regex(/^$|^\d{1,2}:\d{2}(\.\d{1,2})?$/, "Use mm:ss").default("");

export const videoPlanSchema = z
  .object({
    scenes: z
      .array(
        z.object({
          id: z.enum(VIDEO_SCENES.map((s) => s.id) as [string, ...string[]]),
          caption: z.string().trim().max(160).default(""),
          voiceover: z.string().trim().max(400).default(""),
          footage: footageSchema,
          source_in: tc,
          source_out: tc,
        }),
      )
      .length(VIDEO_SCENES.length),
    fallback_montage: z.boolean().default(false),
    captions_reviewed: z.boolean().default(false),
  })
  .strict();
export type VideoPlan = z.infer<typeof videoPlanSchema>;

export function blankVideoPlan(story?: PublicStory): VideoPlan {
  return {
    scenes: VIDEO_SCENES.map((s) => ({
      id: s.id,
      caption: s.id === "hook" && story ? clip(`${story.name}: ${story.pitch}`, 120) : "",
      voiceover: "",
      footage: { kind: "none" as const, url: "", object_key: "", label: "" },
      source_in: "",
      source_out: "",
    })),
    fallback_montage: false,
    captions_reviewed: false,
  };
}

/** Uploaded footage lives under studio/{slug}/ in the private Blob store. */
export const studioPrefix = (slug: string) => `studio/${slug}/`;

export async function getVideoPlan(projectId: number) {
  const [r] = await query<{ version: number; content: unknown; created_at: Date }>(
    "select version, content, created_at from video_plans where project_id = $1 order by version desc limit 1",
    [projectId],
  );
  if (!r) return null;
  const parsed = videoPlanSchema.safeParse(r.content);
  return parsed.success ? { version: r.version, plan: parsed.data, createdAt: r.created_at.toISOString() } : null;
}

/** Problems with a plan, in plain words. Real footage only; a montage must be labelled as stills. */
export function videoChecks(plan: VideoPlan) {
  const issues: string[] = [];
  const real = plan.scenes.filter((s) => s.footage.kind === "upload" || s.footage.kind === "url");
  if (!real.length && !plan.fallback_montage) issues.push("No footage yet. Upload a screen recording, link one, or switch to the labelled screenshot montage.");
  for (const s of plan.scenes) {
    if (!s.caption) issues.push(`Scene “${VIDEO_SCENES.find((v) => v.id === s.id)!.title}” has no caption.`);
    if (s.footage.kind === "screenshots" && !plan.fallback_montage) issues.push(`Scene “${VIDEO_SCENES.find((v) => v.id === s.id)!.title}” uses stills: turn on the screenshot-montage label.`);
  }
  if (!plan.captions_reviewed) issues.push("Captions haven't been reviewed by the team.");
  return issues;
}

export async function saveVideoPlan(access: ProjectAccess, input: unknown): Promise<{ data: { version: number; issues: string[] }; receipt: Receipt }> {
  requireWrite(access);
  const { plan, expected_version } = parse(z.object({ plan: videoPlanSchema, expected_version: z.coerce.number().int().min(0) }), input);
  const prefix = studioPrefix(access.project.slug);
  for (const s of plan.scenes) {
    if (s.footage.object_key && (!s.footage.object_key.startsWith(prefix) || s.footage.object_key.includes(".."))) {
      throw new AppError("VALIDATION_FAILED", { userMessage: "That upload doesn't belong to this team." });
    }
    if (s.footage.kind === "upload" && !s.footage.object_key) throw new AppError("VALIDATION_FAILED", { userMessage: "Finish the upload before saving." });
    if (s.footage.kind === "url" && !s.footage.url) throw new AppError("VALIDATION_FAILED", { userMessage: "Add the footage link (https://)." });
  }
  const version = await withAudit(access.actor, "video.plan.save", "video_plan", async (tx) => {
    const { rows: cur } = await tx.query<{ v: number }>("select coalesce(max(version), 0) as v from video_plans where project_id = $1", [access.project.id]);
    if (cur[0].v !== expected_version) throw new AppError("CONFLICT", { userMessage: `A teammate saved storyboard v${cur[0].v}. Reload to see it.` });
    const { rows } = await tx.query<{ id: number; version: number }>(
      "insert into video_plans (project_id, version, content, created_by) values ($1, $2, $3, $4) returning id, version",
      [access.project.id, expected_version + 1, JSON.stringify(plan), access.member.id],
    );
    return { result: rows[0].version, resourceId: rows[0].id, payload: { montage: plan.fallback_montage } };
  });
  return { data: { version, issues: videoChecks(plan) }, receipt: { id: `VID-${access.project.id}-v${version}`, server_time: (await serverNow()).toISOString() } };
}

/** Footage keys the team may stream back in the studio (anything under its prefix). */
export const isTeamMediaKey = (slug: string, key: string) => key.startsWith(studioPrefix(slug)) && !key.includes("..") && /^[\w./-]+$/.test(key);

/** For social cards and the GTM page: the public site URL of the Ship Page. */
export const shipUrl = (slug: string) => siteUrl(`/ship/${slug}`);
