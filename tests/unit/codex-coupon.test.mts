// The Codex coupon by email, the parts that need no database or network: the SMTP settings
// read from the environment, the email itself, the internal roster API's token check and
// the shape of an "add people to the list" request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerOk, couponEmail, parseRosterAdd, smtpConfig } from "../../src/lib/codex-coupon.ts";

test("no SMTP user or password means email is not set up", () => {
  assert.equal(smtpConfig({}), null);
  assert.equal(smtpConfig({ SMTP_USER: "a@gmail.com" }), null);
  assert.equal(smtpConfig({ SMTP_PASS: "x" }), null);
});

test("SMTP defaults to Gmail over TLS, from the sending account", () => {
  const c = smtpConfig({ SMTP_USER: "organiser@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" })!;
  assert.equal(c.host, "smtp.gmail.com");
  assert.equal(c.port, 465);
  assert.equal(c.secure, true);
  assert.equal(c.requireTLS, false, "465 is TLS from the first byte");
  assert.equal(c.user, "organiser@gmail.com");
  assert.equal(c.pass, "abcdefghijklmnop", "Google shows app passwords in groups of four; the spaces are not part of it");
  assert.equal(c.from, "Kane CLI Hack Day <organiser@gmail.com>");
});

test("SMTP host, port and sender can be overridden", () => {
  const c = smtpConfig({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", MAIL_FROM: "Hack Day <hack@example.com>" })!;
  assert.equal(c.host, "smtp.example.com");
  assert.equal(c.port, 587);
  assert.equal(c.secure, false, "587 is STARTTLS, not implicit TLS");
  assert.equal(c.requireTLS, true, "STARTTLS is required, never optional");
  assert.equal(c.from, "Hack Day <hack@example.com>");
});

test("the coupon email carries the code and greets the person by name", () => {
  const m = couponEmail({ name: "Shivam Mahajan", code: "CDX-ABCD-1234" });
  assert.match(m.subject, /Codex/);
  assert.match(m.text, /CDX-ABCD-1234/);
  assert.match(m.text, /^Hi Shivam Mahajan,/);
  assert.match(m.html, /CDX-ABCD-1234/);
});

test("the coupon email works without a name and escapes what it shows", () => {
  assert.match(couponEmail({ name: null, code: "CODE-1234" }).text, /^Hi there,/);
  const m = couponEmail({ name: "<b>x</b>", code: "CODE-1234" });
  assert.doesNotMatch(m.html, /<b>x<\/b>/);
  assert.match(m.html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("the roster API token: unset or short secret refuses everyone, otherwise exact Bearer match", () => {
  const secret = "s3cret-roster-token-0123456789";
  assert.equal(bearerOk(`Bearer ${secret}`, undefined), false);
  assert.equal(bearerOk("Bearer short", "short"), false, "a secret under 16 characters is treated as not set");
  assert.equal(bearerOk(null, secret), false);
  assert.equal(bearerOk(`Bearer ${secret}x`, secret), false);
  assert.equal(bearerOk(`Basic ${secret}`, secret), false);
  assert.equal(bearerOk(`Bearer ${secret}`, secret), true);
  assert.equal(bearerOk(`bearer  ${secret} `, secret), true);
});

test("add-to-list takes one person or a list, lowercases emails and drops repeats", () => {
  assert.deepEqual(parseRosterAdd({ email: " Ann@Example.com ", name: " Ann Lee " }), [{ email: "ann@example.com", name: "Ann Lee" }]);
  assert.deepEqual(parseRosterAdd({ email: "ann@example.com" }), [{ email: "ann@example.com", name: null }]);
  assert.deepEqual(
    parseRosterAdd({ people: [{ email: "a@example.com", name: "A" }, { email: "A@example.com", name: "A again" }, { email: "b@example.com" }] }),
    [
      { email: "a@example.com", name: "A" },
      { email: "b@example.com", name: null },
    ],
  );
});

test("add-to-list refuses a bad email, an empty list and more than 500 people", () => {
  assert.throws(() => parseRosterAdd({ email: "not-an-email" }));
  assert.throws(() => parseRosterAdd({ people: [] }));
  assert.throws(() => parseRosterAdd({}));
  const many = Array.from({ length: 501 }, (_, i) => ({ email: `p${i}@example.com` }));
  assert.throws(() => parseRosterAdd({ people: many }));
});
