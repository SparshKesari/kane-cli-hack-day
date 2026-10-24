import assert from "node:assert/strict";
import { test } from "node:test";
import { checkProfileFields, githubFromInput } from "../../src/lib/profile-fields.ts";

const ok = { name: "Riya", email: "riya@demo.test", linkedin: "linkedin.com/in/riya", x: "@riya_dev", github: "", password: "long-enough" };

test("a complete profile passes", () => {
  assert.deepEqual(checkProfileFields(ok, { passwordRequired: true }), {});
  assert.deepEqual(checkProfileFields({ ...ok, linkedin: "https://www.linkedin.com/in/riya-k/", x: "https://x.com/riya_dev", github: "https://github.com/riya-dev/" }, { passwordRequired: true }), {});
});

test("LinkedIn is required; X and GitHub are optional", () => {
  const e = checkProfileFields({ ...ok, linkedin: "", x: "" }, { passwordRequired: true });
  assert.match(e.linkedin, /Add your LinkedIn/);
  assert.equal(e.x, undefined);
  assert.equal(e.github, undefined);
  assert.deepEqual(checkProfileFields({ ...ok, x: "" }, { passwordRequired: true }), {});
  assert.deepEqual(checkProfileFields({ ...ok, x: undefined }, { passwordRequired: true }), {});
});

test("each bad field gets its own plain message", () => {
  const e = checkProfileFields({ name: "A", email: "a@b", linkedin: "riya k", x: "riya dev!", github: "cwec,cwe`", password: "short" }, { passwordRequired: true });
  assert.deepEqual(Object.keys(e).sort(), ["email", "github", "linkedin", "name", "password", "x"]);
  assert.match(e.github, /GitHub username/);
  assert.match(e.password, /it has 5/);
});

test("password is only required when asked", () => {
  assert.equal(checkProfileFields({ ...ok, password: "" }, { passwordRequired: false }).password, undefined);
  assert.match(checkProfileFields({ ...ok, password: "" }, { passwordRequired: true }).password, /at least 8/);
});

test("GitHub links become usernames", () => {
  assert.equal(githubFromInput(" https://github.com/riya-dev/ "), "riya-dev");
  assert.equal(githubFromInput("riya-dev"), "riya-dev");
});

test("LinkedIn, X and GitHub take a link or just the name", async () => {
  const { normalizeLinkedin, normalizeX } = await import("../../src/lib/photos.ts");
  assert.equal(normalizeLinkedin("riya-k"), "https://www.linkedin.com/in/riya-k");
  assert.equal(normalizeLinkedin("https://www.linkedin.com/in/riya-k/"), "https://www.linkedin.com/in/riya-k");
  assert.equal(normalizeLinkedin("riya k"), null);
  assert.equal(normalizeX("x.com/riya_dev"), "riya_dev");
  assert.equal(normalizeX("@riya_dev"), "riya_dev");
  assert.deepEqual(checkProfileFields({ ...ok, linkedin: "riya-k", x: "x.com/riya_dev", github: "github.com/riya-dev" }, { passwordRequired: true }), {});
});
