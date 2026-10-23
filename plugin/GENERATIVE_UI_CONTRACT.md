# Generative UI contract (as implemented)

Every MCP tool and `/api/v1` route answers with the same envelope (`src/server/core.ts` `toEnvelope`):

```json
{
  "schema_version": 1,
  "status": "ok | needs_action | partial | error",
  "message": "One sentence for a person.",
  "data": {},
  "evidence": [{ "kind": "kane_run", "id": "KR-12", "confidence": "verified" }],
  "actions": [{ "id": "confirm_submission", "label": "Finalize submission", "requires_human_confirmation": true, "tool": "submission_finalize" }],
  "links": [{ "label": "Proof tab", "url": "https://kaneclihack.sh/t/orbit/proof" }],
  "ui_resource": null,
  "ui_type": "kane_run",
  "design_version": "kane-hack-os@1",
  "fallback": { "text": "KR-12 PASSED · VERIFIED source · https://kaneclihack.sh/t/orbit/proof" },
  "freshness": null,
  "warnings": [],
  "error": null,
  "request_id": "uuid",
  "server_time": "2026-10-24T14:25:00.000Z"
}
```

- `fallback.text` alone must make the workflow usable in a plain terminal.
- `links` are filtered to HTTPS on an allowlist (our domain, github.com, devpost.com, testmuai.com, lu.ma). Anything else is dropped server-side.
- `actions[].requires_human_confirmation` means Codex must get a yes from the person and call again with `explicit_confirmation: true`.
- `ui_resource` is `null` today. MCP Apps resources (T-MCP-06) are not built; never claim a card rendered in Codex.

## Registry

`src/components/gen/registry.tsx` maps `ui_type` to one first-party component in the site theme (ink background, lime for actions only, teal ✓ VERIFIED for evidence-backed success, amber for waiting on a person, red for confirmed failure, grey outline for suspected/unverified):

`builder_passport`, `readiness_check`, `idea_checklist`, `idea_radar`, `team_match`, `mentor_ticket`, `kane_run`, `metric_pulse`, `submission_receipt`, `deck_preview`, `ship_preview`, `social_review`.

Unknown or malformed types render `fallback.text` only. Models never produce markup; they choose tools, and tools return typed data.
