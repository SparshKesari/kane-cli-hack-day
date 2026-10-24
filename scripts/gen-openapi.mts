// Generate the API reference from the route handlers themselves:
//   src/generated/openapi.json   served at /api/v1/openapi.json, rendered at /api/docs
//   docs/api/ENDPOINTS.md        the endpoint list, with live / new / planned status
//
//   npm run docs:api
//
// Every route.ts under src/app/api, src/app/webhooks and src/app/mcp is read for
// its exported HTTP methods and its header comment (the description). Each
// operation is matched to the v2.5 plan (docs/api/plan-v2.5-endpoints.json) and
// to the live branch: present on LIVE_REF (default event-day-flow) = "live",
// otherwise "new"; a handler that only throws NOT_IMPLEMENTED = "planned (501)".
// Access comes from the same rules the proxy enforces (src/lib/testmu-gate.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPath } from "../src/lib/testmu-gate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIVE_REF = process.env.LIVE_REF ?? "event-day-flow";
const PROD_URL = process.env.SITE_URL ?? "https://kaneclihack.sh";

type PlanRow = { group: string; method: string; path: string; summary: string; kind: string };
const plan: PlanRow[] = JSON.parse(readFileSync(join(ROOT, "docs/api/plan-v2.5-endpoints.json"), "utf8"));
const norm = (p: string) => p.replace(/\{[^}]+\}/g, "{}");
const planByKey = new Map(plan.map((r) => [`${r.method} ${norm(r.path)}`, r]));

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

function onLive(file: string) {
  try {
    execFileSync("git", ["cat-file", "-e", `${LIVE_REF}:${relative(ROOT, file)}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The first contiguous // block after the imports. */
function headerComment(src: string) {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("//")) {
    if (/^export /.test(lines[i])) return "";
    i++;
  }
  const out: string[] = [];
  for (; i < lines.length && lines[i].startsWith("//"); i++) out.push(lines[i].replace(/^\/\/ ?/, ""));
  return out.join("\n").trim();
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Access = "public" | "testmu" | "open";

type Op = {
  method: string;
  path: string; // OpenAPI style, /api/v1/teams/{id}
  file: string;
  tag: string;
  summary: string;
  description: string;
  status: "live" | "new" | "planned";
  access: Access;
  plan: PlanRow | null;
  params: string[];
};

const ops: Op[] = [];
for (const base of ["src/app/api", "src/app/webhooks", "src/app/mcp"]) {
  let files: string[] = [];
  try {
    files = walk(join(ROOT, base));
  } catch {
    continue;
  }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const route = "/" + relative(join(ROOT, "src/app"), file).replace(/\/route\.ts$/, "");
    const params = [...route.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const path = route.replace(/\[([^\]]+)\]/g, "{$1}");
    const comment = headerComment(src);
    // Per method: the text from its export to the next export.
    const bodyOf = (m: string) => {
      const start = src.search(new RegExp(`export (async )?(function|const) ${m}\\b`));
      if (start < 0) return "";
      const rest = src.slice(start + 1);
      const end = rest.search(/\nexport /);
      return end < 0 ? rest : rest.slice(0, end);
    };
    const isStub = (m: string) => /notImplemented\(|AppError\("NOT_IMPLEMENTED"/.test(bodyOf(m));
    const live = onLive(file);
    const kind = classifyPath(route.replace(/\[[^\]]+\]/g, "x"), {});
    const access: Access = kind === "open" ? "open" : kind === "public_api" ? "public" : "testmu";
    const segs = path.split("/").filter(Boolean);
    const tag = segs[0] === "api" && segs[1] === "v1" ? segs[2] ?? "v1" : segs[0] === "api" ? segs[1] : segs[0];
    for (const m of METHODS) {
      if (!new RegExp(`export (async )?(function|const) ${m}\\b`).test(src)) continue;
      const p = planByKey.get(`${m} ${norm(path)}`) ?? null;
      const firstLine = comment.split("\n").find((l) => l.trim()) ?? "";
      ops.push({
        method: m,
        path,
        file: relative(ROOT, file),
        tag,
        summary: p?.summary ?? (firstLine.replace(/^(GET|POST|PUT|PATCH|DELETE)(\|\w+)*\s+\S+\s*[:—-]?\s*/i, "").slice(0, 120) || `${m} ${path}`),
        description: comment,
        status: isStub(m) ? "planned" : live ? "live" : "new",
        access,
        plan: p,
        params,
      });
    }
  }
}
ops.sort((a, b) => a.path.localeCompare(b.path) || METHODS.indexOf(a.method as never) - METHODS.indexOf(b.method as never));

// Plan endpoints with no handler at all (should be none once stubs exist).
const have = new Set(ops.map((o) => `${o.method} ${norm(o.path)}`));
const missing = plan.filter((r) => !have.has(`${r.method} ${norm(r.path)}`));

// ── OpenAPI ──────────────────────────────────────────────────────────────────

const STATUS_LABEL = { live: "LIVE in production", new: "NEW on testmu-api", planned: "PLANNED: returns 501 until built" } as const;
const ACCESS_LABEL = {
  open: "No TestMu key (handshake, docs or server-to-server with its own secret).",
  public: "Public aggregate read: no TestMu key needed by default (TESTMU_KEY_PUBLIC_PATHS).",
  testmu: "Requires a TestMu AI access key when TESTMU_KEY_REQUIRED=true: the hd_testmu cookie (browser), X-TestMu-Username + X-TestMu-Access-Key, or Basic auth. Staff cookies also pass. The handler then checks who you are (member, bearer token or staff role).",
} as const;

const KEY_SECURITY = [{ testmuKey: [], testmuUser: [] }, { testmuBasic: [] }, { testmuCookie: [] }, { staffCookie: [] }];
const envelopeRef = { $ref: "#/components/schemas/Envelope" };
const errorResponses = {
  "400": { description: "Validation failed or a business rule refused it (envelope.error.code says which).", content: { "application/json": { schema: envelopeRef } } },
  "401": { description: "TESTMU_KEY_REQUIRED (no or bad TestMu key) or UNAUTHENTICATED (not signed in).", content: { "application/json": { schema: envelopeRef } } },
  "403": { description: "FORBIDDEN, CONSENT_REQUIRED or similar.", content: { "application/json": { schema: envelopeRef } } },
  "503": { description: "TESTMU_UNAVAILABLE or FEATURE_DISABLED.", content: { "application/json": { schema: envelopeRef } } },
};

const paths: Record<string, Record<string, unknown>> = {};
for (const o of ops) {
  const op: Record<string, unknown> = {
    tags: [o.tag],
    operationId: `${o.method.toLowerCase()}_${o.path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    summary: `${o.status === "planned" ? "[501] " : o.status === "new" ? "[new] " : ""}${o.summary}`,
    description: [
      `**Status:** ${STATUS_LABEL[o.status]}  `,
      `**Access:** ${ACCESS_LABEL[o.access]}  `,
      o.plan ? `**Plan v2.5:** ${o.plan.group} · ${o.plan.kind}: ${o.plan.summary}  ` : "**Plan v2.5:** not in the plan (site-specific).  ",
      `**Source:** \`${o.file}\``,
      "",
      o.description ? "```text\n" + o.description + "\n```" : "",
    ].join("\n"),
    parameters: [
      ...o.params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      ...(o.method !== "GET" && o.method !== "DELETE" ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" }, description: "Retries with the same key return the original result." }] : []),
    ],
    responses: {
      "200": { description: "Envelope with status ok | needs_action | partial.", content: { "application/json": { schema: envelopeRef } } },
      ...errorResponses,
      ...(o.status === "planned" ? { "501": { description: "NOT_IMPLEMENTED: in the v2.5 plan, not built yet.", content: { "application/json": { schema: envelopeRef } } } } : {}),
    },
    "x-status": o.status,
    "x-access": o.access,
  };
  if (o.access === "testmu") op.security = KEY_SECURITY;
  else op.security = [];
  if (["POST", "PUT", "PATCH"].includes(o.method)) {
    op.requestBody = { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: true } } }, description: "JSON object; fields are listed in the description above." };
  }
  (paths[o.path] ??= {})[o.method.toLowerCase()] = op;
}

const counts = { live: ops.filter((o) => o.status === "live").length, new: ops.filter((o) => o.status === "new").length, planned: ops.filter((o) => o.status === "planned").length };

const spec = {
  openapi: "3.1.0",
  info: {
    title: "KANE HACK OS API",
    version: "2.5.0",
    description: [
      "Every Hack OS operation: the Codex skills, `kanehack` CLI, MCP and the website all call these.",
      "",
      `**${ops.length} operations**: ${counts.live} live in production, ${counts.new} new on this branch, ${counts.planned} planned (return 501).`,
      "",
      "### TestMu AI access key",
      "When `TESTMU_KEY_REQUIRED=true`, every non-public operation needs a TestMu AI access key:",
      "- **Browser:** connect once at `/api/v1/auth/testmu/start`. TestMu AI redirects back with the key, we verify it and set the `hd_testmu` cookie (the key itself is never stored).",
      "- **CLI / agents:** send `X-TestMu-Username` and `X-TestMu-Access-Key` (or `Authorization: Basic base64(username:access_key)`).",
      "",
      "A pairing bearer token (`kanehack pair`) still says *who* you are; the TestMu key says the call is allowed at all. Send both headers if you use both.",
      "",
      "### Envelope",
      "Every JSON response uses the same envelope (`status`, `message`, `data`, `actions`, `error`, `fallback.text`…). Errors carry `error.code`, `next_action` and a `manual_route` web fallback.",
    ].join("\n"),
  },
  servers: [{ url: PROD_URL, description: "Production" }, { url: "/", description: "This deployment" }],
  tags: [...new Set(ops.map((o) => o.tag))].sort().map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      testmuUser: { type: "apiKey", in: "header", name: "X-TestMu-Username", description: "Your TestMu AI username." },
      testmuKey: { type: "apiKey", in: "header", name: "X-TestMu-Access-Key", description: "Your TestMu AI access key (Account → Access key on TestMu AI)." },
      testmuBasic: { type: "http", scheme: "basic", description: "username = TestMu AI username, password = access key." },
      testmuCookie: { type: "apiKey", in: "cookie", name: "hd_testmu", description: "Set by /api/v1/auth/testmu/callback after TestMu AI redirects back." },
      staffCookie: { type: "apiKey", in: "cookie", name: "hd_staff", description: "Staff sign-in at /ops/login." },
      pairingBearer: { type: "http", scheme: "bearer", description: "Identity token from `kanehack pair` (not a TestMu key)." },
    },
    schemas: {
      Envelope: {
        type: "object",
        required: ["schema_version", "status", "message", "data", "request_id", "server_time"],
        properties: {
          schema_version: { type: "integer", const: 1 },
          status: { type: "string", enum: ["ok", "needs_action", "partial", "error"] },
          message: { type: "string" },
          data: {},
          evidence: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, id: { type: "string" }, confidence: { type: "string", enum: ["verified", "participant_reported", "inferred", "unverified"] }, url: { type: "string" } } } },
          actions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, requires_human_confirmation: { type: "boolean" }, href: { type: "string" }, tool: { type: "string" } } } },
          links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } } } },
          ui_resource: { type: ["string", "null"] },
          ui_type: { type: ["string", "null"] },
          design_version: { type: "string" },
          fallback: { type: "object", properties: { text: { type: "string" } } },
          freshness: { type: ["object", "null"], properties: { as_of: { type: "string" }, state: { type: "string", enum: ["fresh", "delayed", "stale", "offline"] }, source: { type: "string" } } },
          warnings: { type: "array", items: { type: "string" } },
          error: {
            type: ["object", "null"],
            properties: { code: { type: "string", examples: ["TESTMU_KEY_REQUIRED", "UNAUTHENTICATED", "TEAM_FULL", "NOT_IMPLEMENTED"] }, message: { type: "string" }, next_action: { type: "string" }, manual_route: { type: "string" }, details: {} },
          },
          request_id: { type: "string" },
          server_time: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

mkdirSync(join(ROOT, "src/generated"), { recursive: true });
writeFileSync(join(ROOT, "src/generated/openapi.json"), JSON.stringify(spec, null, 1) + "\n");

// ── ENDPOINTS.md ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const md: string[] = [
  "# KANE HACK OS: API endpoint list",
  "",
  "Generated by `npm run docs:api` from the route handlers. Don't edit by hand.",
  `Interactive docs: \`/api/docs\` (Swagger UI) · spec: \`/api/v1/openapi.json\` · TestMu key setup: [TESTMU_ACCESS.md](TESTMU_ACCESS.md)`,
  "",
  `**${ops.length} operations**: ${counts.live} **live** in production (\`${LIVE_REF}\`), ${counts.new} **new** on this branch, ${counts.planned} **planned** (return 501).`,
  `Plan v2.5 coverage: ${plan.length - missing.length}/${plan.length} plan endpoints have a handler.`,
  "",
  "Access: **key** = needs the TestMu AI access key when `TESTMU_KEY_REQUIRED=true` · **public** = aggregate read, open by default · **open** = handshake, docs, or server-to-server.",
  "",
];
for (const tag of [...new Set(ops.map((o) => o.tag))].sort()) {
  md.push(`## ${tag}`, "", "| Method | Path | Status | Access | Plan v2.5 | What it does |", "|---|---|---|---|---|---|");
  for (const o of ops.filter((x) => x.tag === tag)) {
    md.push(`| ${o.method} | \`${o.path}\` | ${o.status} | ${o.access === "testmu" ? "key" : o.access} | ${o.plan ? "yes" : "—"} | ${esc(o.summary)} |`);
  }
  md.push("");
}
if (missing.length) {
  md.push("## Plan endpoints with no handler yet", "", "| Method | Path | Plan summary |", "|---|---|---|");
  for (const r of missing) md.push(`| ${r.method} | \`${r.path}\` | ${esc(r.summary)} |`);
  md.push("");
}
writeFileSync(join(ROOT, "docs/api/ENDPOINTS.md"), md.join("\n"));

console.log(`openapi: ${ops.length} operations (${counts.live} live, ${counts.new} new, ${counts.planned} planned); plan missing: ${missing.length}`);
