import { createRequire } from "node:module";

// NextRequest / NextResponse are plain Web Request/Response wrappers: the real ones work
// outside a request, so src/proxy.ts can be called directly in tests.
// (Required from next/dist directly: "next/server" itself resolves back to this stub.)
const require = createRequire(import.meta.url);
export const NextRequest = require("next/dist/server/web/spec-extension/request").NextRequest;
export const NextResponse = require("next/dist/server/web/spec-extension/response").NextResponse;

// after() runs work once the response is sent; in tests, run it straight away.
export function after(task) {
  Promise.resolve()
    .then(() => (typeof task === "function" ? task() : task))
    .catch(() => {});
}
