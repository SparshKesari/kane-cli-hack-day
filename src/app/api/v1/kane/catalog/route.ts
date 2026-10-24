import { envelopeResponse } from "@/server/core";
import { KANE_CAPABILITIES } from "@/server/kane";

// GET /api/v1/kane/catalog (public)
// The Kane CLI capability catalog: each official command, what it proves, the
// completion signal to parse and its official doc. Only commands the official
// reference publishes; plans and versions vary (check `kane-cli --version`).

export async function GET() {
  return envelopeResponse(async () => ({
    message: `${KANE_CAPABILITIES.length} Kane CLI capabilities.`,
    data: { capabilities: KANE_CAPABILITIES, skill_install: "npx @testmuai/kane-cli-skill" },
    links: [{ label: "Kane CLI reference", url: "https://www.testmuai.com/docs/kane-cli-cli-reference" }],
    fallbackText: KANE_CAPABILITIES.map((c) => `${c.label}: ${c.command}`).join("\n"),
  }));
}
