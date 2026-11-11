// What a team may attach. Client-safe: the picker and the server both use it.

export const MAX_FILES = 8;
export const MAX_BYTES = 25 * 1024 * 1024;

/** Extension → content type. Nothing that a browser would run as a page. */
export const ALLOWED: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  key: "application/vnd.apple.keynote",
  txt: "text/plain",
  md: "text/markdown",
};

export const ACCEPT = Object.keys(ALLOWED).map((e) => `.${e}`).join(",");
export const TYPES_LABEL = "PDF, images, PowerPoint, Keynote, Word, text";

export const extOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";
export const teamPrefix = (teamId: number) => `online/t${teamId}/`;

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
