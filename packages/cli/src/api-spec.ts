import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  // Dynamic import of the web app's Hono API app
  const { apiApp } = await import("../../../apps/web/server/api");

  const spec = apiApp.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Starter API", version: "1.0.0" },
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
