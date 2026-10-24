# TestMu AI access key: mandatory auth for the API and site

Every Hack OS API call and participant page sits behind the participant's TestMu AI
access key. The switch is `TESTMU_KEY_REQUIRED`.

Interactive API docs: **`/api/docs`** · spec: **`/api/v1/openapi.json`** · endpoint list: [ENDPOINTS.md](ENDPOINTS.md)

## Activation: the profile gets the key (main path)

```
/register  (or POST /api/v1/auth/register)
  name · Luma email · LinkedIn · X · GitHub · password
        │  profile saved, account created
        ▼
  our server ──POST TESTMU_PROVISION_URL──► TestMu AI
        {name, email, linkedin, x, github, external_id: "member:<id>",
         event: "kane-cli-hack-day", source: "kaneclihack.sh"}
        Authorization: Bearer TESTMU_PROVISION_TOKEN
        ◄── 200 {username, access_key, email?}    (TestMu creates or finds the account)
        │
        ▼
  testmu_links: username + member + fingerprint of the key (the key is NOT stored)
  browser: hd_testmu cookie (signed, 12h) + the key shown ONCE on /register
  API caller: data.testmu = {username, access_key}, returned ONCE
```

From then on the key is the credential for everything: the browser carries it as the
cookie, Kane CLI / Codex / MCP send it as headers. The proxy matches it against the
stored fingerprint, so no verify call to TestMu is needed per request.

Signing in again on another device (`/passport/login`) and then opening any gated page
re-runs activation for that member (TestMu returns the same account), sets the cookie
and carries on. If TestMu can't be reached, the person lands on `/register` with an
"Activate TestMu AI" retry button; failures are kept in `testmu_provision_failures` for staff.

### What TestMu AI's endpoint must do

- Accept the POST above, authenticated by our server token.
- Create the account, or return the existing one for that email (we call it again on
  every new device sign-in and on retries, so it must be idempotent).
- Answer `200 {"username": "...", "access_key": "...", "email": "..."}`
  (`user_name` / `accessKey` or the same fields under `data` are accepted too).
- 4xx with `{"message": "..."}` for details it rejects (shown to the person); 5xx for outages.

## Connect an existing TestMu login (optional)

When `TESTMU_AUTH_URL` is set, people who are not signed in can instead be sent to
TestMu's login page, which redirects back:

```
Participant ── /api/v1/auth/testmu/start?next=/team ──► TestMu AI (register / log in / connect)
                                                              │
   ◄── /api/v1/auth/testmu/callback?state=…&username=…&access_key=…   (or ?code=…)
```

CLI / Codex / MCP callers send the key on each request instead:

```
X-TestMu-Username: alex@example.com
X-TestMu-Access-Key: <access key>
# or: Authorization: Basic base64(username:access_key)
```

`src/proxy.ts` checks the key with TestMu (cached 5 min per instance) and forwards a
60-second signed principal; `getMember()` maps it to the registration with the same
email. A `kanehack pair` bearer token still works for identity. With the switch on it
needs the key headers too, so send both.

## The switch

| `TESTMU_KEY_REQUIRED` | What happens |
|---|---|
| unset / `false` (default) | Site works exactly as today. A valid key still signs a CLI call in; an **invalid** key is refused (401). |
| `true` | `/api/v1/*`, `/mcp`, `/api/upload`, `/{team}/status`: 401 `TESTMU_KEY_REQUIRED` without the cookie or key headers. Participant pages (`/team /activate /setup /passport /t/* /studio/* /match /submit /help /pair /readiness /me`): activate (signed in) or go to `/register`, then back. |

Always open: `/register`, `/passport/login` and `POST /api/v1/auth/register` (where the key
comes from), the handshake (`/api/v1/auth/testmu/*`), `/api/docs`, `/api/v1/openapi.json`,
cron, webhooks and the photo import (they have their own secrets), the landing page,
`/ship/*`, `/live`, `/dashboard`, `/ops/*`, `/judge`.
Staff (`hd_staff` / `hd_admin` cookies) pass the gate: they aren't TestMu users.

Public aggregate reads stay open by default (TV, Mission Control, public Ship Page data,
receipt checks, event brief, Kane catalog). Set `TESTMU_KEY_PUBLIC_PATHS=none` to gate
them too, or a comma-separated list of prefixes to choose. Note that `/live` and
`/dashboard` poll these, so gating them will blank the TV screens.

Roll back: set `TESTMU_KEY_REQUIRED=false` in Vercel (takes effect on the next request
after the env change is applied to the deployment).

## Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| `TESTMU_KEY_REQUIRED` | to enforce | `true` turns the gate on |
| `TESTMU_PROVISION_URL` | production | TestMu AI account endpoint the profile is sent to (see above). Unset in production = activation off |
| `TESTMU_PROVISION_TOKEN` | production | Bearer token our server sends to it |
| `TESTMU_AUTH_URL` | optional | TestMu login page for the connect flow; we append `redirect_uri` and `state` |
| `TESTMU_VERIFY_URL` | optional | Only for keys we didn't provision: GET with Basic `username:access_key`; 2xx = valid, 401/403 = invalid. Email read from `email`, `data.email`, `user.email` or `data.user.email` |
| `TESTMU_TOKEN_URL` | if TestMu sends a code | POST `{code, redirect_uri}` → `{username, access_key, email?}` |
| `TESTMU_CALLBACK_USERNAME_PARAM` / `TESTMU_CALLBACK_KEY_PARAM` | if names differ | default `username` / `access_key` |
| `TESTMU_KEY_PUBLIC_PATHS` | optional | see above |
| `TESTMU_VERIFY_STUB` | dev only | `valid` (default) / `invalid` when no verify URL outside production |

Outside production with no `TESTMU_AUTH_URL`, `/start` loops straight to a stub callback
(`dev-user` / `dev-key`) so the flow can be clicked through on a preview. In production a
missing URL fails closed with 503 `TESTMU_UNAVAILABLE`.

## Still needed from TestMu AI

1. **The account endpoint** described above (URL + the server token), set as
   `TESTMU_PROVISION_URL` / `TESTMU_PROVISION_TOKEN`. This is the only thing that blocks
   switching the gate on.
2. Optional: a login URL + callback parameters for the connect flow, and a verify endpoint
   for keys that didn't come through activation.

## Turning it on

1. Set `TESTMU_PROVISION_URL` and `TESTMU_PROVISION_TOKEN` in Vercel (production). New
   profiles now activate and show the key.
2. Register once yourself and check the key shows and `/team` loads.
3. Set `TESTMU_KEY_REQUIRED=true`. People who registered earlier are activated
   automatically the next time they open a participant page while signed in.

## Database

`db/034_testmu_access.sql` adds `testmu_links` (additive; run `npm run db:migrate`).

## Team sync: one TestMu AI org per team

TestMu AI builds one org per hack-day team. Every claim (`/activate` step 2) opens its own org
with the claimer as its Admin. When the **captain** of a locked team claims and the claim
succeeds (`SIGNEDUP`, `JOINED_TEAM`, `ALREADY_CLAIMED`, `ALREADY_ACTIVE`), the same TestMu AI
password, in memory only, is used to call the team invite API once per other current member,
one at a time:

```
POST TESTMU_TEAM_INVITE_URL   /api/trials/hack-day/team/invite
  {email: <captain's email>, password: <the password typed in step 2>, member_email}
```

| `code` | Meaning | Next |
|---|---|---|
| `MEMBER_ADDED` | A teammate who already claimed moved into the captain's org | done |
| `MEMBER_INVITED` | Not claimed yet: their claim answers `JOINED_TEAM` | done |
| `ALREADY_IN_TEAM` | Already there | done |
| `INVALID_CREDENTIALS` | Wrong password | stop, retry with the step-2 password |
| `NOT_TEAM_LEAD` | The captain isn't the Admin of their own Hack Day account | stop, help desk |
| `NOT_HACK_DAY_ORG` | The teammate has a TestMu AI account but never claimed | they do step 2, then retry |
| `MEMBER_IN_ANOTHER_TEAM` / `ALREADY_INVITED` | The teammate is in, or invited to, another org | help desk |
| `TEAM_FULL` | 4 people including pending invites | stop, help desk |
| 429 | Rate limited | a `Retry-After` up to 20 s is waited out once, else stop |

Each answer is kept in `testmu_team_sync` (`db/039_testmu_team_sync.sql`: one row per team and
teammate with `code`, `message`, `organization_id`, `attempted_at`) and audited as
`testmu.team_sync` with the codes only. The password is never stored, logged, audited or put in
a URL. A sync failure never blocks the claim, step 3 or our roster lock: the captain stays on
`/activate`, sees each teammate's status, and gets "Retry team invites", which asks for the
password again and skips members already at `MEMBER_ADDED`, `MEMBER_INVITED` or
`ALREADY_IN_TEAM`. A solo team and a non-captain's claim make no invite calls. A captain who
claimed before the roster was locked syncs from the same retry once it is.

| Variable | Needed | Meaning |
|---|---|---|
| `TESTMU_TEAM_INVITE_URL` | optional | Production default `https://backend.lambdatest.com/api/trials/hack-day/team/invite`. Elsewhere it is used only when it points at a host other than lambdatest.com / testmuai.com (a mock) |
| `TESTMU_TEAM_INVITE_STUB` | dev only | The code the stub answers outside production (default `MEMBER_ADDED`). `+testmu-<code>` in a teammate's email (`bob+testmu-team-full@example.com`) picks it per teammate |

For a stateful local mock of both Hack Day APIs (accounts, orgs, invites, rate limits), run
`node tests/support/testmu-mock.mjs --port 3105` and point `TESTMU_TRIAL_CLAIM_URL` and
`TESTMU_TEAM_INVITE_URL` at it.
