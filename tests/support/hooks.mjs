// Node module hooks for running src/ TypeScript under `node --test` without a
// bundler: resolves the "@/…" alias and extension-less imports, and swaps the
// Next.js runtime modules that only exist inside a request for small stubs, and
// nodemailer for one that records mail instead of sending it.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stub = (name) => pathToFileURL(path.join(root, "tests/support/stubs", name)).href;
const STUBS = {
  "server-only": stub("empty.mjs"),
  "next/headers": stub("next-headers.mjs"),
  "next/navigation": stub("next-navigation.mjs"),
  "next/cache": stub("next-cache.mjs"),
  "next/server": stub("next-server.mjs"),
  nodemailer: stub("nodemailer.mjs"),
};

function probe(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const hit = probe(path.join(root, "src", specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const hit = probe(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return next(specifier, context);
}
