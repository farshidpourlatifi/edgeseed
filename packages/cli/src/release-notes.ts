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

/**
 * Every failure path ends in a note on stdout and exit 0 — including a missing
 * or unreadable file, which `readFileSync` would otherwise throw on. The header
 * above promises this and it has to be literally true: the deploy has already
 * happened by the time this runs, so any non-zero exit here blocks the release
 * for a Worker that is live.
 */
function preamble(outputPath: string | undefined): string {
  if (!outputPath) {
    console.error("release:notes: no wrangler output path given.");
    return "Deployed to Cloudflare Workers — deploy output was not available.";
  }

  let deploy;
  try {
    deploy = parseDeployOutput(readFileSync(outputPath, "utf8"));
  } catch (error) {
    console.error(`release:notes: could not read ${outputPath}: ${String(error)}`);
    return "Deployed to Cloudflare Workers — deploy output could not be read.";
  }

  if (!deploy) return "Deployed to Cloudflare Workers — no version id in the deploy output.";

  const targets = deploy.targets.length > 0 ? ` Targets: ${deploy.targets.join(", ")}.` : "";
  return `Deployed to Cloudflare Workers — version \`${deploy.versionId}\`.${targets}`;
}

console.log(preamble(process.argv[2]));
