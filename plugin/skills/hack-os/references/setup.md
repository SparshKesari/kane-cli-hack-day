# Setup and sign-in

Goal: this machine can reach the event server as this person, and Codex has the event tools.

## 1. Check the machine

Run `kanehack doctor --json` and read its checks. Fix only what failed, one at a time, using the fix each check names. The ones that matter most:

- `kane_cli` missing → `npm i -g @testmuai/kane-cli`. Then `kane-cli whoami`; if not signed in, the person runs `kane-cli login --oauth` and approves in their browser.
- `kane_skill` missing → `npx @testmuai/kane-cli-skill`.
- `codex` → `codex login status`; if not signed in, the person runs `codex login`.
- `testmu_key` failed → step 2 decides whether it matters.
- `api` failed → network problem; check Wi-Fi, then retry.

`kanehack` itself missing → they run the install command: `curl -fsSL https://kaneclihack.sh/install.sh | sh` (Windows: `irm https://www.kaneclihack.sh/install.ps1 | iex`).

Intel Mac: Kane CLI doesn't support it. Send them to the help desk for a loaner or a teammate's machine.

## 2. Sign in: profile, pairing, TestMu key

Ask first: "Have you saved your profile on https://kaneclihack.sh/register?" If not → `references/signup-team.md` and stop until they're done. Pairing can't be approved without a profile.

**Pair this machine (required: the event's Codex tools only accept a paired machine).**

1. `kanehack pair --start --json`. Show only `user_code` and `verification_url`; they approve in the browser while signed in to the site.
2. `kanehack pair --wait --timeout 30 --json`. Exit 0 = paired. 4 = still pending: wait and run it again. 3 = server unreachable: check network. 1 = expired or denied: start again.

**Save the TestMu AI key if the site asks for one.** Run `node <skill>/scripts/state.mjs key-required`.

- `false` → skip this part. Doctor's `testmu_key` check will still fail; that's expected, say nothing about it.
- `true`, or `null` (couldn't tell) → the username and key are shown on `/register` once the profile is saved.
  1. Ask them to run `kanehack login` **in their own terminal window**, not in this chat, and paste the username and key there. Never ask for the key here.
  2. `kanehack doctor --json` again: `testmu_key` should pass. If it says the key isn't linked to a Hack Day profile, they finish the profile on `/register`. If `/register` shows no key, send them to the help desk.

If TESTMU_USERNAME / TESTMU_ACCESS_KEY or LT_USERNAME / LT_ACCESS_KEY are set in their environment, they're sent instead of the saved key; a personal LambdaTest key there causes "not accepted". They unset those or use their event key.

## 3. Connect Codex to the event tools

`kanehack connect codex` (it backs up Codex's config; never copies a secret into it). Codex loads the `kane-hack-event` tools only in a **new** session. For the rest of this session use `node <skill>/scripts/event-api.mjs list` and `node <skill>/scripts/event-api.mjs call <tool> --args <file.json>`; for a tool that changes something, add `--confirmed` only after the person approved those exact arguments.

## 4. Done when

`participant_get_status` answers with their name. Go back to `SKILL.md` and route from there.
