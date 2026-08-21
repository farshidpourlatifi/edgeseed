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
  /**
   * A second path, requested once the target is ready, that must reach code
   * validating the env through `parseEnv`.
   *
   * `path` above proves the bundle *starts*. It does not prove the Worker's
   * **bindings** are named the way the code reads them — and wrangler deploys a
   * mismatch without complaint, so a renamed `[[ratelimits]]` or KV binding
   * would take every auth route down with the whole gate green.
   *
   * Only needed where readiness is served by a route that never touches the
   * env. `@starter/web` polls `/api/v1/health`, which already sits behind
   * `authMiddleware` and therefore behind `parseEnv` — one request covers both.
   * `@starter/mcp` answers `/` from static metadata on purpose, so it needs
   * this second request to reach `authFor`.
   */
  envProbe?: string;
}

export const BOOT_TARGETS: readonly BootTarget[] = [
  { name: "@starter/web", cwd: "apps/web", port: 8791, path: "/api/v1/health" },
  /**
   * `/api/auth/ok` is Better Auth's own health endpoint: it answers `{ok:true}`
   * and touches no database, so it isolates "the bindings resolved" from
   * "the local D1 happens to be migrated". Reaching it runs `authFor`, which
   * calls `parseEnv(mcpEnvSchema, …)` before constructing anything.
   *
   * Requiring 2xx rather than merely "not 5xx" is deliberate. Any path under
   * `/api/auth/**` would prove the env validated, since `authFor` runs before
   * the request is routed — but then a mistyped probe would 404 and keep
   * passing, and the check would quietly stop proving anything. A 2xx ties it
   * to a route that must actually exist.
   */
  { name: "@starter/mcp", cwd: "apps/mcp", port: 8792, path: "/", envProbe: "/api/auth/ok" },
];

/**
 * The minimum env a Worker needs to serve anything, supplied as `--var` so this
 * check does not depend on a `.dev.vars` that exists on a laptop and not in CI.
 *
 * That claim is only true because of `BOOT_ENV_FILE` below. `--var` overrides a
 * key; it does not stop wrangler loading the rest of the file underneath, so
 * this list is the Worker's **whole** env rather than the part that happened to
 * be enumerated.
 *
 * These are throwaway values and must never look otherwise: the point is to
 * prove the *bundle runs*, not that the deployment is configured. Since
 * `authMiddleware` validates the env on every request and refuses when it is
 * missing (`docs/security-audit.md` #3), a Worker with no secret correctly
 * serves nothing — which would make this check assert "is CI configured"
 * instead of "does the bundle boot".
 *
 * The secret is 32+ characters and is deliberately not Better Auth's default,
 * because the schema rejects both — `boot-check.test.ts` asserts it against the
 * real schema rather than against a length, since that default is 38 characters
 * and passed `.min(32)` for months.
 */
export const BOOT_VARS: Readonly<Record<string, string>> = {
  BETTER_AUTH_SECRET: "boot-check-throwaway-secret-not-for-any-real-use",
  BETTER_AUTH_URL: "http://127.0.0.1:8791",
};

/**
 * A committed empty file handed to `wrangler dev --env-file`, which is what
 * makes `BOOT_VARS` the complete env instead of an override list.
 *
 * `getVarsForDev` loads `.dev.vars` — and, when no `--env-file` is given,
 * `.env`/`.env.local` — for every key the CLI does not override. So without
 * this the Worker inherits whatever the developer has configured locally:
 * `RESEND_API_KEY`, `MARKETING_URL`, `LOG_LEVEL`, the OAuth client pairs.
 *
 * That is not hypothetical. An inherited real `SENTRY_DSN` made the mcp
 * `envProbe` take 76 s of an 83 s run, because `withSentry` holds the response
 * on a flush that `enableLogs` turns into a network round trip per log line —
 * the mechanism is documented once, in `tests/e2e/mcp-client.ts`, which pins
 * the same variable for the same reason. Measured 2026-08-22: the same probe
 * answers in 35 ms with this file supplied, and never returned within 100 s
 * without it.
 *
 * Pinning that one key would have fixed that one stall. This fixes the class:
 * the next binding that changes request-path behaviour cannot arrive by
 * inheritance, so there is no allowlist to keep up to date.
 *
 * **Accepted trade, stated rather than discovered later.** No run of the gate
 * now boots a Worker with Sentry actually initialising: CI never had a DSN, the
 * e2e suite pins it empty too, and this removes the developer's inherited one —
 * which was the only party exercising that path, and by accident. So a
 * `@sentry/cloudflare` upgrade whose `init` throws on workerd is the same shape
 * of failure this check was built for (`zod` resolving to a major the bundle
 * did not expect) and would clear the whole gate, first caught by
 * `check:deployed` after the tag has deployed. It is not covered here on
 * purpose: a real DSN makes the probe slow and reports throwaway-env noise into
 * a live project, and an unroutable one buys a flush that hangs — both of which
 * cost the gate more than the risk they retire. Covering it needs a Worker-side
 * test that stubs the transport, not an env var.
 *
 * Path is relative to this package's root, resolved against the module rather
 * than the working directory since wrangler runs with `cwd` set to a target.
 * The name deliberately does not start with `.env`, which `.gitignore` excludes
 * — an ignored fixture would exist on a laptop and be missing in CI, which is
 * the exact failure this whole file is about.
 */
export const BOOT_ENV_FILE = "boot-check.env";

/**
 * The complete env argument list `wrangler dev` is started with.
 *
 * One function rather than two call sites so a test can assert what the check
 * actually passes. Asserting the pieces separately let the `= BOOT_VARS`
 * default binding go unexercised: it could be changed to `{}` with every test
 * still green, and the Worker would then inherit `.dev.vars` wholesale.
 */
export function bootEnvArgs(
  envFile: string,
  vars: Readonly<Record<string, string>> = BOOT_VARS,
): string[] {
  return ["--env-file", envFile, ...bootVarArgs(vars)];
}

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

/** The `envProbe` request for a target, or null when it declares none. */
export function envProbeUrl(target: BootTarget): string | null {
  if (!target.envProbe) return null;
  return `http://127.0.0.1:${target.port}${target.envProbe}`;
}

/** The bare origin, used to ask whether *anything* already holds the port. */
export function originUrl(target: BootTarget): string {
  return `http://127.0.0.1:${target.port}/`;
}

/**
 * Why a listener already on the port is a hard failure rather than a free pass.
 *
 * Without this the check adopts it: wrangler fails to bind, but the readiness
 * poll runs before the spawned process has exited, so the first `fetch` is
 * answered by whatever is already there and `boot ok` is printed for a bundle
 * that never started — the precise false green this gate exists to prevent.
 * Reproduced 2026-08-22 with a 12-line node server on 8791.
 *
 * These ports belong to this check alone (dev servers use 5173 and 8788), and
 * `killTree` only runs when this process exits normally — a SIGKILL orphans the
 * detached child. So anything here is a leftover or a sibling clone's, and is
 * foreign by definition. `tests/e2e/mcp-client.ts` refuses for the same reason.
 */
export function portOccupiedReason(target: BootTarget): string {
  return (
    `something is already listening on 127.0.0.1:${target.port}, so this check ` +
    `would test that process instead of the bundle just built. Stop it and ` +
    `re-run: lsof -nP -iTCP:${target.port} -sTCP:LISTEN`
  );
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
  /**
   * The check could not run, as opposed to the bundle failing to run — a port
   * collision being the only such case today.
   *
   * The distinction is not cosmetic: the footer below is a claim *about the
   * bundle*, written to stop a real failure being dismissed as flaky. Printing
   * it when nothing was tested asserts the opposite of what happened, and this
   * repo treats a confidently wrong message as worse than no message.
   */
  blocked?: boolean;
}

export function summarize(failures: readonly BootFailure[], total: number): string {
  if (failures.length === 0) {
    return `boot ok: ${total} worker${total === 1 ? "" : "s"} started and served a request`;
  }
  // `every`, not `some`: one genuine failure alongside a blocked target still
  // means a bundle was proven broken, and that is the louder claim of the two.
  const footer = failures.every((f) => f.blocked)
    ? "The check did not run, so nothing here says whether the bundle works."
    : "The bundle compiles but does not run. `pnpm deploy:web` would ship this.";
  return [
    `boot FAILED for ${failures.length} of ${total} worker(s):`,
    ...failures.map((f) => `  ${f.target}: ${f.reason}`),
    "",
    footer,
  ].join("\n");
}
