/**
 * Refuse to deploy a tag older than what production is already serving.
 *
 * `check:release-version` compares the tag against **GitHub Releases**, which
 * leaves a hole: the release is created last, so a run that deployed `v1.2.2`
 * and then failed its smoke check leaves production on 1.2.2 with no release
 * recording it. A queued `v1.2.1` then passes that guard and silently takes
 * production backwards — precisely in the window where something already went
 * wrong.
 *
 * Production itself is the authority, so ask it. Origins come from the
 * `routes` already declared in `wrangler.jsonc`, so this needs no new
 * configuration and cannot drift from where the app actually runs.
 *
 * **Allows the deploy when production cannot be reached**, deliberately. This
 * guard exists to stop a downgrade, not to stop a recovery: a Worker that is
 * down or serving errors must remain deployable, and refusing there would make
 * an outage unfixable. Only a live, answering production can veto.
 *
 * Usage: pnpm check:not-downgrade <tag> [wrangler.jsonc]
 */
import { readFileSync } from "node:fs";

import {
  compareVersions,
  parseTagVersion,
  smokeUrls,
  wranglerRoutePatterns,
} from "./lib/release-version";

const REQUEST_TIMEOUT_MS = 10_000;

const [tagArg, wranglerPath = "apps/web/wrangler.jsonc"] = process.argv.slice(2);
const tag = tagArg ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error("Usage: pnpm check:not-downgrade <tag> [wrangler.jsonc]");
  process.exit(1);
}

const version = parseTagVersion(tag);

if (version === null) {
  console.error(`Refusing to deploy: "${tag}" is not a vMAJOR.MINOR.PATCH release tag.`);
  process.exit(1);
}

const origins = smokeUrls(wranglerRoutePatterns(readFileSync(wranglerPath, "utf8")));

if (origins.length === 0) {
  console.log(`No routes declared in ${wranglerPath} — nothing deployed to compare against.`);
  process.exit(0);
}

/** The version an origin reports, or null when it does not answer with one. */
async function liveVersion(origin: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

const live = (await Promise.all(origins.map(liveVersion))).filter(
  (reported): reported is string => reported !== null,
);

if (live.length === 0) {
  console.log(
    `No origin reported a version (${origins.join(", ")}) — treating as first deploy or ` +
      `recovery, and allowing ${tag}.`,
  );
  process.exit(0);
}

const blocking = live.filter((reported) => compareVersions(reported, version) >= 0);

if (blocking.length > 0) {
  console.error(
    `Refusing to deploy ${tag}: production is already serving ` +
      `${[...new Set(blocking)].join(", ")}. Deploying would take it backwards.`,
  );
  console.error(
    "\nThis usually means a newer tag deployed but its release never completed. " +
      "Cut a version above the live one rather than re-running this tag.",
  );
  process.exit(1);
}

console.log(`Production is serving ${[...new Set(live)].join(", ")}; ${tag} moves it forward.`);
