import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { parseSpecArgs, specState } from "./lib/api-spec";

async function main() {
  // Before the app is imported, so a mistyped flag costs nothing and writes
  // nothing.
  const args = parseSpecArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    console.error("Usage: pnpm api:spec [--check]");
    process.exit(1);
  }

  // Dynamic import of the web app's Hono API app
  const { apiApp, OPENAPI_INFO } = await import("../../../apps/web/server/api");

  // `OPENAPI_INFO` rather than a copy: this file used to declare its own title
  // and version, and both drifted from what `/api/v1/doc` actually serves.
  const spec = apiApp.getOpenAPI31Document({
    openapi: "3.1.0",
    info: OPENAPI_INFO,
  });
  const rendered = JSON.stringify(spec, null, 2);

  const outDir = join("docs", "api");
  const outPath = join(outDir, "openapi.json");

  if (args.check) {
    // The working tree, not the index: a spec regenerated but not yet staged is
    // in sync, and this mode never writes.
    const state = specState(rendered, existsSync(outPath) ? readFileSync(outPath, "utf8") : null);
    if (state === "current") {
      console.log(`api-spec ok: ${outPath} matches the API`);
      return;
    }
    console.error(
      `${outPath} is ${state === "missing" ? "missing" : "out of date with the API"}.` +
        " Run `pnpm api:spec` and commit the result.",
    );
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, rendered);
  console.log(`OpenAPI spec written to ${outPath}`);
}

main().catch((err) => {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
});
