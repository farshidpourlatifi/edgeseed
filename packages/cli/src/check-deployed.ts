/**
 * Prove the tagged version is live on **every** deploy target, before a release
 * claims it is.
 *
 * `wrangler deploy` succeeding means the bundle uploaded — nothing more. A
 * Worker whose `BETTER_AUTH_SECRET` was never set deploys clean and then 500s
 * on every request (`docs/security-audit.md` #3, and AGENTS.md's standing
 * concern #2 about renaming a Worker into an empty secret store). Without this
 * the release workflow would happily publish a release for a dead deploy.
 *
 * Three things it is deliberate about:
 *
 * - **Asserts the version, not a 200.** The *previous* deploy also answers 200,
 *   so a status check alone passes against a deploy that never landed.
 * - **Requires every target.** Passing on the first healthy origin would let a
 *   broken second custom domain hide behind a working first — and a hostname
 *   nobody checks is exactly where a bad route sits unnoticed.
 * - **Retries within a deadline.** A deploy is not visible on every edge at
 *   once, so the first request can legitimately still see the old version.
 *   Failing on that would make a good release look broken.
 *
 * Usage: pnpm check:deployed <wrangler-output.ndjson> <expected-version>
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { backoffMs, healthProblem, parseDeployOutput, smokeUrls } from "./lib/release-version";

/** Per request. Without it a hung connection stalls the job to its own timeout. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Total per origin, across retries. Propagation is seconds, not minutes. */
const PROPAGATION_DEADLINE_MS = 90_000;

const [outputPath, expectedVersion] = process.argv.slice(2);

if (!outputPath || !expectedVersion) {
  console.error("Usage: pnpm check:deployed <wrangler-output.ndjson> <expected-version>");
  process.exit(1);
}

const deploy = parseDeployOutput(readFileSync(outputPath, "utf8"));

if (!deploy) {
  console.error(`No deploy record in ${outputPath} — cannot tell what went live.`);
  process.exit(1);
}

const urls = smokeUrls(deploy.targets);

if (urls.length === 0) {
  console.error(
    `Deploy ${deploy.versionId} reported no requestable target ` +
      `(targets: ${JSON.stringify(deploy.targets)}).`,
  );
  process.exit(1);
}

/** The last reason this origin was not serving the expected version. */
async function healthMiss(endpoint: string): Promise<string | null> {
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    return healthProblem(await response.json(), expectedVersion);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Poll one origin until it serves the expected version or the deadline passes.
 *
 * The deadline is checked before sleeping as well as before requesting, so a
 * backoff never pushes the last attempt past it — the reported duration and the
 * configured one stay the same number.
 */
async function waitForVersion(url: string): Promise<string | null> {
  const endpoint = `${url}/api/v1/health`;
  const deadline = Date.now() + PROPAGATION_DEADLINE_MS;

  for (let attempt = 0; ; attempt++) {
    const miss = await healthMiss(endpoint);
    if (miss === null) {
      console.log(`  ${endpoint} → ${expectedVersion}`);
      return null;
    }

    const delay = backoffMs(attempt);
    if (Date.now() + delay >= deadline) return `${endpoint} → ${miss}`;
    await sleep(delay);
  }
}

console.log(
  `Checking ${urls.length} target(s) for ${expectedVersion} (deploy ${deploy.versionId})`,
);

// Concurrently: propagation delay is wall-clock, and serialising would spend
// each origin's deadline one after another.
const failures = (await Promise.all(urls.map(waitForVersion))).filter(
  (failure): failure is string => failure !== null,
);

if (failures.length > 0) {
  console.error(`Not serving ${expectedVersion} after deploying ${deploy.versionId}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`All ${urls.length} target(s) serving ${expectedVersion}`);
