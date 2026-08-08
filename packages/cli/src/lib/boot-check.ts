/**
 * Pure helpers for `pnpm check:boot`.
 *
 * The gate this supports exists because `pnpm build` proves a Worker *compiles*,
 * not that it *starts*. A bundle whose module init throws — a dependency calling
 * an API its resolved version does not have, say — builds cleanly and dies on the
 * first request. `deploy:web` would ship it.
 */

export interface BootTarget {
  /** Label used in output. */
  name: string;
  /** Directory to run `wrangler dev` in, relative to the repo root. */
  cwd: string;
  /** Port to bind. Must be free. */
  port: number;
  /** Path polled for readiness. Must not require auth. */
  path: string;
}

export const BOOT_TARGETS: readonly BootTarget[] = [
  { name: "@starter/web", cwd: "apps/web", port: 8791, path: "/api/v1/health" },
  { name: "@starter/mcp", cwd: "apps/mcp", port: 8792, path: "/" },
];

/**
 * The minimum env a Worker needs to serve anything, supplied as `--var` so this
 * check does not depend on a `.dev.vars` that exists on a laptop and not in CI.
 *
 * These are throwaway values and must never look otherwise: the point is to
 * prove the *bundle runs*, not that the deployment is configured. Since
 * `authMiddleware` validates the env on every request and refuses when it is
 * missing (`docs/security-audit.md` #3), a Worker with no secret correctly
 * serves nothing — which would make this check assert "is CI configured"
 * instead of "does the bundle boot".
 *
 * The secret is 32+ characters and is deliberately not Better Auth's default,
 * because the schema rejects both.
 */
export const BOOT_VARS: Readonly<Record<string, string>> = {
  BETTER_AUTH_SECRET: "boot-check-throwaway-secret-not-for-any-real-use",
  BETTER_AUTH_URL: "http://127.0.0.1:8791",
};

/** `--var KEY:value` pairs for `wrangler dev`. */
export function bootVarArgs(vars: Readonly<Record<string, string>> = BOOT_VARS): string[] {
  return Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]);
}

/**
 * wrangler prints this when workerd refuses to start — typically a throw during
 * module evaluation. Detecting it lets the check fail in a second instead of
 * waiting out the readiness timeout.
 */
const RUNTIME_START_FAILURE = /The Workers runtime failed to start/i;

/** Uncaught errors wrangler surfaces before the runtime comes up. */
const UNCAUGHT = /Uncaught\s+\w*Error:.*/;

// wrangler colourises its output even when piped, so escapes end up mid-message
// and leak into the reason string.
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

export function isRuntimeStartFailure(output: string): boolean {
  return RUNTIME_START_FAILURE.test(stripAnsi(output));
}

/**
 * Pull the most useful line out of wrangler's noise, so a failure reports the
 * actual cause rather than a wall of startup logging.
 */
export function extractBootError(output: string): string | null {
  const clean = stripAnsi(output);
  const uncaught = UNCAUGHT.exec(clean);
  if (uncaught) return uncaught[0].trim();
  if (isRuntimeStartFailure(clean)) return "The Workers runtime failed to start";
  return null;
}

export function healthUrl(target: BootTarget): string {
  return `http://127.0.0.1:${target.port}${target.path}`;
}

/**
 * A boot is only successful on a 2xx. A 5xx means the Worker is listening but
 * broken, which is exactly the state this check exists to catch — treat it as
 * failure, not readiness.
 */
export function isHealthyStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export interface BootFailure {
  target: string;
  reason: string;
}

export function summarize(failures: readonly BootFailure[], total: number): string {
  if (failures.length === 0) {
    return `boot ok: ${total} worker${total === 1 ? "" : "s"} started and served a request`;
  }
  return [
    `boot FAILED for ${failures.length} of ${total} worker(s):`,
    ...failures.map((f) => `  ${f.target}: ${f.reason}`),
    "",
    "The bundle compiles but does not run. `pnpm deploy:web` would ship this.",
  ].join("\n");
}
