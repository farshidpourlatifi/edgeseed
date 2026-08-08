import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  // Dynamic import of the web app's Hono API app
  const { apiApp, OPENAPI_INFO } = await import("../../../apps/web/server/api");

  // `OPENAPI_INFO` rather than a copy: this file used to declare its own title
  // and version, and both drifted from what `/api/v1/doc` actually serves.
  const spec = apiApp.getOpenAPI31Document({
    openapi: "3.1.0",
    info: OPENAPI_INFO,
  });

  const outDir = join("docs", "api");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "openapi.json");
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  console.log(`OpenAPI spec written to ${outPath}`);
}

main().catch((err) => {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
});
