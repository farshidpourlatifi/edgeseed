/**
 * Print the release-note preamble for a deploy, from wrangler's structured
 * output (`WRANGLER_OUTPUT_FILE_PATH`).
 *
 * GitHub prepends this to its own generated notes (`--generate-notes`), so the
 * release records *which Cloudflare version is live* rather than only which
 * commits went into it. Cloudflare's rollback takes a Version ID, so that is
 * the field you need when a release turns out to be the bad one.
 *
 * Deliberately never fails: by the time this runs the deploy has happened and
 * been smoke-checked, and exiting non-zero here would leave a live Worker with
 * no release at all. A missing record is reported in the body instead.
 *
 * Usage: pnpm release:notes <wrangler-output.ndjson>
 */
import { readFileSync } from "node:fs";

import { parseDeployOutput } from "./lib/release-version";

const outputPath = process.argv[2];

if (!outputPath) {
  console.error("Usage: pnpm release:notes <wrangler-output.ndjson>");
  process.exit(1);
}

const deploy = parseDeployOutput(readFileSync(outputPath, "utf8"));

if (!deploy) {
  console.log("Deployed to Cloudflare Workers — no version id in the deploy output.");
} else {
  const targets = deploy.targets.length > 0 ? ` Targets: ${deploy.targets.join(", ")}.` : "";
  console.log(`Deployed to Cloudflare Workers — version \`${deploy.versionId}\`.${targets}`);
}
