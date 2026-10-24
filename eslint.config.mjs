import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees and tooling (separate checkouts, linted on their own).
    ".claude/**",
    // hack-gtm's Remotion video project: participants install and build it themselves.
    "plugin/skills/*/scripts/remotion/**",
    ".agents/skills/*/scripts/remotion/**",
  ]),
]);

export default eslintConfig;
