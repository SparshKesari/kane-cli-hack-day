import { envelopeResponse } from "@/server/core";
import { idParam } from "@/server/kane-http";
import { notImplemented } from "@/server/plan-v25";
import { authorizeProject } from "@/server/story";
import { checkGithubCommit, getSubmissionContext } from "@/server/submission";
import { query } from "@/lib/db";

// /api/v1/projects/{id}/repository/verification   team members; organizers may read
//   GET   what we know about the project's repo today: the repo URL and commit
//         on the submission draft, repositories linked by GitHub push
//         webhooks, and (with ?check=1) whether GitHub can see that commit.
//         This is the existing submission preflight check, not the v2.5
//         OAuth-verified ownership record.
//   POST  start an authenticated GitHub verification (501 until the GitHub
//         App/OAuth repo-access check is built).

type RepoLink = { repo_full_name: string; repo_id: string | null; default_branch: string | null; last_commit_sha: string | null; last_push_at: Date | null };

export async function GET(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/repository/verification">) {
  return envelopeResponse(async () => {
    const access = await authorizeProject(idParam((await ctx.params).id), { req });
    const sc = await getSubmissionContext(access.project.team_id);
    const links = await query<RepoLink>(
      "select repo_full_name, repo_id, default_branch, last_commit_sha, last_push_at from repository_links where project_id = $1 order by id",
      [access.project.id],
    );
    const repoUrl = sc.draft.repo_url ?? access.project.repo_url ?? null;
    const sha = sc.draft.commit_sha ?? null;
    const github = new URL(req.url).searchParams.get("check") === "1" && repoUrl && sha ? await checkGithubCommit(repoUrl, sha) : (sc.preflight.github ?? null);
    const state = !repoUrl ? "unlinked" : github === "found" ? "commit_visible" : github === "missing" ? "commit_not_found" : "unchecked";
    return {
      status: state === "commit_visible" ? "ok" : "needs_action",
      message: `Repository: ${state.replaceAll("_", " ")}.`,
      data: {
        state,
        repo_url: repoUrl,
        submitted_sha: sha,
        github_check: github,
        ownership_verified: false,
        webhook_links: links.map((l) => ({ ...l, last_push_at: l.last_push_at ? new Date(l.last_push_at).toISOString() : null })),
      },
      warnings: ["Ownership/access verification through GitHub OAuth (v2.5) isn't built; a visible commit only shows the repo is public and the SHA exists."],
    };
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/v1/projects/[id]/repository/verification">) {
  return envelopeResponse(async () => {
    await authorizeProject(idParam((await ctx.params).id), { req, write: true });
    notImplemented("Authenticated GitHub repository verification needs the GitHub App / OAuth repo-access check, which isn't built yet. Use GET ?check=1 for the public commit check.");
  });
}
