import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // /admin moved to /ops (Hack OS). 308 so bookmarks and old links keep working.
  async redirects() {
    return [
      { source: "/admin", destination: "/ops", permanent: true },
      { source: "/admin/:path*", destination: "/ops/:path*", permanent: true },
      // event-day-flow: pages folded into the new participant flow (temporary, so they can come back).
      { source: "/login", destination: "/passport/login", permanent: false },
      { source: "/team/new", destination: "/team", permanent: false },
      { source: "/team/join", destination: "/team", permanent: false },
      { source: "/team/:slug/manage", destination: "/team", permanent: false },
      { source: "/activate/phone", destination: "/register", permanent: false },
      { source: "/docs", destination: "/setup", permanent: false },
      { source: "/resources", destination: "/me", permanent: false },
      { source: "/content-hour", destination: "/me", permanent: false },
    ];
  },
  // /{team-slug}/status is the short address the Codex hook pings. A fallback
  // rewrite, so it only applies when no page matches: /ship/status, /t/status and
  // other dynamic pages of that shape keep their own route.
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/:team/status", destination: "/api/v1/teams/:team/status" }] };
  },
  // Security headers (T-SEC-01). CSP keeps 'unsafe-inline' for scripts because
  // the App Router inlines its bootstrap; everything else is same-origin only.
  // Images/connect allow https (Vercel Blob uploads and photos). HSTS only in
  // production and without includeSubDomains until every subdomain is HTTPS.
  async headers() {
    const prod = process.env.VERCEL_ENV === "production";
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://vercel.live`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob: https:",
      "worker-src 'self' blob:",
      // Ship pages embed a team's demo video (YouTube nocookie or Loom).
      "frame-src 'self' https://vercel.live https://www.youtube-nocookie.com https://www.loom.com",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      ...(prod ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    const common = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Camera stays available to this origin for selfies and badge scanning.
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }] : []),
    ];
    return [
      { source: "/:path*", headers: common },
      // Staff pages and paper copies stay out of search engines.
      { source: "/ops/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/print/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // Swagger UI (/api/docs) loads its pinned bundle from jsdelivr; only this page may.
      {
        source: "/api/docs",
        headers: [{ key: "Content-Security-Policy", value: csp.replace("script-src 'self'", "script-src 'self' https://cdn.jsdelivr.net").replace("style-src 'self'", "style-src 'self' https://cdn.jsdelivr.net") }],
      },
      // Installers are read before they're run: serve them as UTF-8 text, not octet-stream, so
      // browsers show them and PowerShell's irm decodes them as text (✓ marks included).
      { source: "/install.sh", headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }] },
      { source: "/install.ps1", headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }] },
      // A team's one-pager (docs/api/TEAM_PAGE.md) gets the deck's custom-HTML sandbox (deck.ts sandboxDoc) plus https media.
      {
        source: "/ship/:slug/one-pager",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "sandbox allow-scripts; default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
