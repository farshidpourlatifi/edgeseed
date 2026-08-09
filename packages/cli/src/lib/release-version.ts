/**
 * Pure logic for the tag-triggered release: the guard that runs before the
 * deploy, and the checks that run after it.
 *
 * A GitHub Release names a version. The Worker reports one at `/api/v1/health`
 * from `APP_VERSION`. Nothing keeps those two honest on its own: `version:bump`
 * writes `packages/config/src/version.ts` with a regex replace, so a rename
 * that stopped it matching would move `package.json` and leave `APP_VERSION`
 * behind — and the release would claim a version that was never deployed.
 * `wrangler deploy` cannot catch that either: it uploads happily against a
 * Worker whose secrets were never set, and only a request to the live origin
 * shows the 500.
 *
 * Kept separate from the script bodies so the deny paths are unit- and
 * mutation-testable without a tag, a checkout, or a deploy.
 */

/**
 * The version a `v`-prefixed release tag names, or `null` when the tag is not
 * one this repo can produce.
 *
 * Deliberately strict — plain `major.minor.patch` only. `version:bump` is the
 * sole producer of these tags and it only ever emits that shape, so anything
 * else (a `latest` tag, `v1.2`, a prerelease suffix) is a mistake, and the
 * cost of catching it is one refused workflow run rather than a deploy whose
 * release record disagrees with the code.
 */
export function parseTagVersion(tag: string): string | null {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag.trim());
  return match ? match[1] : null;
}

/**
 * Order two `major.minor.patch` versions: negative, zero or positive, like any
 * comparator. Numeric per component, so `0.10.0` sorts above `0.9.0` — the
 * string comparison that looks equivalent gets that backwards.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * Why this tag must not be released given what is already released, or `null`
 * when it is the newest.
 *
 * Guards a downgrade. Tag pushes queue, and **GitHub does not guarantee the
 * order queued runs execute in** — so `v1.2.2` can finish while `v1.2.1` is
 * still waiting, and `v1.2.1` then deploys over it and silently takes
 * production backwards. Concurrency settings cannot fix that; only refusing a
 * non-increasing version can.
 *
 * Unparseable tags are ignored rather than rejected: a repo may carry tags that
 * were never releases, and they say nothing about ordering.
 */
export function releaseOrderProblem(tag: string, existingTags: string[]): string | null {
  const version = parseTagVersion(tag);
  if (version === null) return `Tag "${tag}" is not a vMAJOR.MINOR.PATCH release tag`;

  const newer = existingTags
    .map(parseTagVersion)
    .filter((existing): existing is string => existing !== null)
    .filter((existing) => compareVersions(existing, version) >= 0);

  if (newer.length === 0) return null;

  const highest = newer.sort(compareVersions).at(-1);
  return `v${highest} is already released; ${tag} would take production backwards`;
}

/** `APP_VERSION` as declared in `packages/config/src/version.ts` source. */
export function parseAppVersion(versionTsSource: string): string | null {
  const match = /APP_VERSION\s*=\s*"([^"]+)"/.exec(versionTsSource);
  return match ? match[1] : null;
}

/**
 * Every disagreement between the tag being released and the versions the
 * build will actually report. Empty means the release is safe to deploy.
 */
export function releaseVersionProblems(input: {
  tag: string;
  packageVersion: string;
  appVersion: string | null;
}): string[] {
  const tagVersion = parseTagVersion(input.tag);
  if (tagVersion === null) {
    return [`Tag "${input.tag}" is not a vMAJOR.MINOR.PATCH release tag`];
  }

  const problems: string[] = [];
  if (input.packageVersion !== tagVersion) {
    problems.push(`package.json version is ${input.packageVersion}, tag says ${tagVersion}`);
  }
  if (input.appVersion === null) {
    problems.push("APP_VERSION not found in packages/config/src/version.ts");
  } else if (input.appVersion !== tagVersion) {
    problems.push(`APP_VERSION is ${input.appVersion}, tag says ${tagVersion}`);
  }
  return problems;
}

/** One `type: "deploy"` record from wrangler's structured output. */
export interface DeployRecord {
  versionId: string;
  targets: string[];
}

/**
 * The deploy wrangler reports in `WRANGLER_OUTPUT_FILE_PATH` — NDJSON, one
 * JSON object per line, **appended** across every wrangler invocation sharing
 * the variable.
 *
 * Read from the structured file rather than scraped from the console: the
 * human-readable output is not a contract, and a release body that silently
 * lost the one field tying it to a deployment is exactly the failure this
 * exists to prevent.
 *
 * Takes the **last** deploy record, because `deploy:web` runs the whole verify
 * gate first — `check:boot` drives wrangler too, and anything it appends comes
 * earlier in the same file. Malformed lines are skipped rather than thrown on:
 * wrangler owns this format, and a future entry type this version cannot parse
 * must not fail a deploy that already succeeded.
 */
export function parseDeployOutput(ndjson: string): DeployRecord | null {
  let found: DeployRecord | null = null;

  for (const line of ndjson.split("\n")) {
    // No blank-line guard: `JSON.parse("")` throws and the catch below skips it,
    // so one would be dead code that only looks like caution.
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const record = entry as { type?: unknown; version_id?: unknown; targets?: unknown };
    if (record.type !== "deploy" || typeof record.version_id !== "string") continue;

    found = {
      versionId: record.version_id,
      targets: Array.isArray(record.targets)
        ? record.targets.filter((t): t is string => typeof t === "string")
        : [],
    };
  }

  return found;
}

/**
 * A hostname: two or more dot-separated alphanumeric/hyphen labels.
 *
 * Used as the filter rather than "is not empty", because wrangler's target list
 * is a **display** list and carries entries that name no host at all — see
 * `smokeUrls`.
 */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Origins to smoke-test, derived from a deploy's targets.
 *
 * Deriving them beats configuring them: a clone that never set up a custom
 * domain deploys to `workers.dev` and gets a working check for free, and this
 * repo's two `custom_domain` routes both resolve to something requestable.
 *
 * **A target is a rendered display string, not a hostname.** `renderRoute()`
 * appends the route's kind, so a real entry reads
 * `app.edgeseed.dev (custom domain)` — and wrangler writes those same strings
 * into the structured output, since the list it prints and the list it records
 * are one array. Parsing this as a bare host yields
 * `https://app.edgeseed.dev (custom domain)`, which fails every request and
 * would block the release *after* a successful deploy. Take the first
 * whitespace-delimited token.
 *
 * The same list can hold `...and 3 more routes` (wrangler truncates past ten)
 * and wildcard patterns, neither of which names one origin. Hence a positive
 * hostname test rather than a blocklist: anything that is not clearly a host is
 * dropped, and callers treat an empty result as a failure, never as "nothing to
 * check".
 */
export function smokeUrls(targets: string[]): string[] {
  const origins = targets
    .map((target) => target.trim().split(/\s/)[0])
    // The `^` on the protocol strip is belt-and-braces: the token holds no
    // whitespace and `split("/")` takes the first segment, so a protocol can
    // only ever match at the start. Kept because it states the intent.
    .map((token) => token.replace(/^https?:\/\//, "").split("/")[0])
    .filter((host) => HOSTNAME.test(host))
    .map((host) => `https://${host}`);

  return [...new Set(origins)];
}

/**
 * Exponential backoff for the post-deploy poll, capped so a long propagation
 * deadline does not turn into one enormous sleep at the end.
 *
 * A deploy is not instantly visible on every edge, so the first requests after
 * one can legitimately answer with the previous version. Retrying is what keeps
 * that from reading as a failed release.
 */
export function backoffMs(attempt: number, capMs = 8_000): number {
  return Math.min(capMs, 500 * 2 ** attempt);
}

/**
 * Why a `/api/v1/health` body does not prove the tagged version is live, or
 * `null` when it does.
 *
 * The version comparison is the point. A 200 alone only proves *something*
 * answers on that hostname — the previous deploy answers a 200 too.
 */
export function healthProblem(body: unknown, expectedVersion: string): string | null {
  const health = body as { status?: unknown; version?: unknown };

  if (health?.status !== "ok") {
    return `health reported status ${JSON.stringify(health?.status)}, expected "ok"`;
  }
  if (health.version !== expectedVersion) {
    return `health reported version ${JSON.stringify(health.version)}, expected ${JSON.stringify(expectedVersion)}`;
  }
  return null;
}
