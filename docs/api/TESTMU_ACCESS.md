# TestMu AI access key: how the API and site are gated

Branch `testmu-api`. Every Hack OS API call and participant page can be put behind
the participant's TestMu AI access key with one switch, without a redeploy.

Interactive API docs: **`/api/docs`** · spec: **`/api/v1/openapi.json`** · endpoint list: [ENDPOINTS.md](ENDPOINTS.md)

## The flow

```
Participant ── /api/v1/auth/testmu/start?next=/team ──► TestMu AI (register / log in / connect)
                                                              │
   ◄── /api/v1/auth/testmu/callback?state=…&username=…&access_key=…   (or ?code=…)
          1. state must match the hd_testmu_state cookie we set at /start (15 min)
          2. key checked with TestMu (TESTMU_VERIFY_URL, Basic username:access_key)
          3. testmu_links row upserted: username, member, email hash, key fingerprint
             (the key itself is never stored)
          4. hd_testmu cookie (signed, 12h) + personal sign-in when the TestMu email
             matches a registration; otherwise on to /register
          5. redirect to `next`
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
| `true` | `/api/v1/*`, `/mcp`, `/api/upload`: 401 `TESTMU_KEY_REQUIRED` without the cookie or key headers. Participant pages (`/register /team /activate /setup /passport /t/* /studio/* /match /submit /help /pair /readiness /me`): redirect to TestMu connect, then back. |

Always open: the handshake (`/api/v1/auth/testmu/*`), `/api/docs`, `/api/v1/openapi.json`,
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
| `TESTMU_AUTH_URL` | production | TestMu page we send people to; we append `redirect_uri` and `state` |
| `TESTMU_VERIFY_URL` | production | GET with Basic `username:access_key`; 2xx = valid, 401/403 = invalid. Email read from `email`, `data.email`, `user.email` or `data.user.email` |
| `TESTMU_TOKEN_URL` | if TestMu sends a code | POST `{code, redirect_uri}` → `{username, access_key, email?}` |
| `TESTMU_CALLBACK_USERNAME_PARAM` / `TESTMU_CALLBACK_KEY_PARAM` | if names differ | default `username` / `access_key` |
| `TESTMU_KEY_PUBLIC_PATHS` | optional | see above |
| `TESTMU_VERIFY_STUB` | dev only | `valid` (default) / `invalid` when no verify URL outside production |

Outside production with no `TESTMU_AUTH_URL`, `/start` loops straight to a stub callback
(`dev-user` / `dev-key`) so the flow can be clicked through on a preview. In production a
missing URL fails closed with 503 `TESTMU_UNAVAILABLE`.

## Still needed from TestMu AI

1. The connect/login URL and the exact callback parameter names (key directly, or a code).
2. An endpoint that validates `username:access_key` and ideally returns the account email.
3. Register both callback URLs: `https://kaneclihack.sh/api/v1/auth/testmu/callback` and the preview URL.
4. Prefer `response_mode=form_post` or a code exchange, so the key never appears in a URL
   (the callback accepts POST for this).

## Database

`db/034_testmu_access.sql` adds `testmu_links` (additive; run `npm run db:migrate`).
