This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Hack OS workflow and owners

Open `/ops/workflow` as organizer/admin to assign owner names, track pending/in-progress/blocked/done work, add blockers/next actions and filter by person or workflow step. Assignments are shared in the event database and audited; run `npm run db:migrate` to apply `034_workflow_ownership.sql` before using the board. Concurrent stale saves are rejected; refresh before retrying.

The participant/skill/backend diagram is `/hack-os-flow.html`. The single skill lives at `plugin/skills/hack-os`, with a distribution archive at `public/hack-os-skills-1.2.0.tgz`. The current production installer is unchanged; `docs/hack-os/release` contains pending API contracts, validation notes and a rollout patch proposal. The public-bucket and team-page APIs remain pending until their contracts are supplied. Owners and readiness statuses are organizer decisions, separate from participant completion and judging eligibility.

Pending supplied components now include a local idea-validator subskill, video skills/guidelines with an upload option, and POST team-status reporting after each team-scoped Codex turn. Their entrypoints/endpoints remain unset in `plugin/skills/hack-os/references/components.json`. The status endpoint, lifecycle trigger and delivery wiring have separate assignable tasks. Skill-guided before-yield checkpoints do not guarantee coverage of Codex turns outside the skill; a supported host adapter remains pending.

Approved planning assignments are committed in `src/data/hack-os-owners.json` from the user's local export. The 21 exported owner/status/note values are preserved; seven newer tasks stay unassigned. The standalone preview starts from this snapshot and preserves browser-local overrides. The shared tracker uses the snapshot only for the matching event where no database assignment exists; saved event records, including intentionally cleared owners, take precedence. Snapshot completion statuses are organizer planning decisions rather than independently verified implementation.
