/**
 * An action error in one line: its message, then each issue it doesn't already say, led by the
 * field it is about ("links repo commit: …"). A schema failure's message is generic, so its
 * issues carry the detail; a review failure's message is its first issue, so that one isn't repeated.
 */
export function issueText(error: { message: string; details?: Record<string, unknown> | null }) {
  const issues = (error.details?.issues as { path?: string; message: string }[] | undefined) ?? [];
  const field = (path = "") => (/[._]/.test(path) ? `${path.replace(/\.(\d+)/g, (_, n: string) => ` ${Number(n) + 1}`).replace(/[._]/g, " ")}: ` : "");
  return [error.message, ...issues.filter((i) => i.message !== error.message).map((i) => `${field(i.path)}${i.message}`)].join(" ");
}
