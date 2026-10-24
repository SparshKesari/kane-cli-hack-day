// The site's Idea Validator asks the model exactly what $hack-os does in Codex.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOURCE, TARGET, promptFrom, render } from "../../scripts/gen-idea-validator.mjs";

test("the generated prompt matches the skill's idea-validator.md (run npm run gen:idea-validator)", () => {
  assert.equal(readFileSync(TARGET, "utf8"), render(promptFrom(readFileSync(SOURCE, "utf8"))));
});

test("both copies of the skill carry the same validator prompt", () => {
  assert.equal(readFileSync(SOURCE, "utf8"), readFileSync(".agents/skills/hack-os/references/idea-validator.md", "utf8"));
});
