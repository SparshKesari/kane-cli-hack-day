import { startGuideMarkdown } from "@/data/start-guide";

// GET /start.md: the /start guide as markdown, so an agent can read the whole flow
// (curl -fsSL https://kaneclihack.sh/start.md). Same source as the page: src/data/start-guide.ts.
export function GET() {
  return new Response(startGuideMarkdown(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
