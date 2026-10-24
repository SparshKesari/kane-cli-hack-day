import "server-only";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import { query } from "@/lib/db";

// LLMs draft, summarise and recommend. They never own deadlines, permissions,
// scores, identity or publication. Every call here has a deterministic
// fallback, so the feature still works when the AI Gateway is down or not
// configured; results say which path produced them.
//
// Model: env HACKOS_MODEL (default "openai/gpt-5-mini"), routed through the
// Vercel AI Gateway (AI_GATEWAY_API_KEY locally, OIDC on Vercel).

export const MODEL = process.env.HACKOS_MODEL ?? "openai/gpt-5-mini";
const TIMEOUT_MS = 20_000;

export type Drafted<T> = { value: T; generator: "llm" | "rules"; model: string | null; warning?: string };

const configured = () => !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);

async function markGateway(ok: boolean, code?: string) {
  await query(
    ok
      ? "update integration_state set status = 'ok', last_success_at = now(), updated_at = now() where system = 'ai_gateway'"
      : "update integration_state set status = 'degraded', last_error_at = now(), last_error_code = $1, updated_at = now() where system = 'ai_gateway'",
    ok ? [] : [code ?? "error"],
  ).catch(() => {});
}

/**
 * Structured draft: the model fills `schema`; on any failure (not configured,
 * timeout, invalid output) `fallback()` runs instead. Never pass private data
 * the user hasn't agreed to send, and never secrets.
 */
export async function draftObject<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  fallback: () => z.infer<S> | Promise<z.infer<S>>;
  /** Longer answers (the Idea Validator) need more than the default 20 s. */
  timeoutMs?: number;
}): Promise<Drafted<z.infer<S>>> {
  if (!configured()) return { value: await opts.fallback(), generator: "rules", model: null, warning: "AI not configured; rule-based draft." };
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
    void markGateway(true);
    return { value: object as z.infer<S>, generator: "llm", model: MODEL };
  } catch (err) {
    console.error("[ai] draftObject fell back to rules", (err as Error)?.name);
    void markGateway(false, (err as Error)?.name);
    return { value: await opts.fallback(), generator: "rules", model: null, warning: "AI unavailable; rule-based draft." };
  }
}

/** Plain-text draft with the same fallback contract. */
export async function draftText(opts: { system: string; prompt: string; fallback: () => string | Promise<string> }): Promise<Drafted<string>> {
  if (!configured()) return { value: await opts.fallback(), generator: "rules", model: null, warning: "AI not configured; rule-based draft." };
  try {
    const { text } = await generateText({ model: MODEL, system: opts.system, prompt: opts.prompt, abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    void markGateway(true);
    return { value: text, generator: "llm", model: MODEL };
  } catch (err) {
    console.error("[ai] draftText fell back to rules", (err as Error)?.name);
    void markGateway(false, (err as Error)?.name);
    return { value: await opts.fallback(), generator: "rules", model: null, warning: "AI unavailable; rule-based draft." };
  }
}
