// GET /api/docs   Swagger UI over /api/v1/openapi.json. Public: no TestMu key.
// "Authorize" takes a TestMu username + access key for "Try it out"; the key
// stays in this browser tab (persistAuthorization is off).

const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hack OS API</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
<style>
  body { margin: 0; background: #fff; }
  .topbar { display: none; }
  .hackos-bar { font: 600 14px/1.4 system-ui, sans-serif; padding: 12px 16px; background: #0b0b0c; color: #e9ff70; }
  .hackos-bar a { color: #fff; margin-left: 12px; }
</style>
</head>
<body>
<div class="hackos-bar">KANE HACK OS API <a href="/api/v1/openapi.json">openapi.json</a><a href="/api/v1/auth/testmu/start">Connect TestMu AI</a></div>
<div id="ui"></div>
<script src="${SWAGGER}/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.ui = SwaggerUIBundle({
    url: "/api/v1/openapi.json",
    dom_id: "#ui",
    deepLinking: true,
    docExpansion: "none",
    filter: true,
    persistAuthorization: false,
    tryItOutEnabled: false,
  });
</script>
</body>
</html>`;

export function GET() {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
