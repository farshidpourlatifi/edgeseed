import { describe, it, expect } from "vitest";
import { webEnvSchema } from "@starter/config/env";
import {
  BOOT_ENV_FILE,
  BOOT_TARGETS,
  BOOT_VARS,
  bootEnvArgs,
  bootVarArgs,
  envProbeUrl,
  portOccupiedReason,
  extractBootError,
  healthUrl,
  isHealthyStatus,
  isRuntimeStartFailure,
  stripAnsi,
  summarize,
} from "../lib/boot-check";

// Exactly what wrangler emits when piped — colour escapes and all.
const COLOURISED =
  "[31m✘ [41;31m[[41;97mERROR[41;31m][0m Uncaught TypeError: coerce.boolean(...).meta is not a function[0m";

// The real failure this gate exists to catch, as wrangler reports it.
const ZOD_CONFLICT_OUTPUT = `
[wrangler:info] Ready on http://127.0.0.1:8791
✘ [ERROR] service core:user:starter-web: Uncaught TypeError: coerce.boolean(...).meta is not a function
✘ [ERROR] The Workers runtime failed to start. There is likely additional debug output above.
`;

describe("isRuntimeStartFailure", () => {
  it("detects wrangler's fatal startup message", () => {
    expect(isRuntimeStartFailure(ZOD_CONFLICT_OUTPUT)).toBe(true);
  });

  it("does not fire on healthy startup output", () => {
    expect(isRuntimeStartFailure("[wrangler:info] Ready on http://127.0.0.1:8791")).toBe(false);
  });

  // "Ready on ..." is printed before module init throws, so readiness logging
  // must never be treated as proof the Worker works.
  it("still fires when the fatal line follows a Ready line", () => {
    expect(ZOD_CONFLICT_OUTPUT).toContain("Ready on");
    expect(isRuntimeStartFailure(ZOD_CONFLICT_OUTPUT)).toBe(true);
  });
});

describe("stripAnsi", () => {
  it("removes colour escapes", () => {
    expect(stripAnsi(COLOURISED)).toBe(
      "✘ [ERROR] Uncaught TypeError: coerce.boolean(...).meta is not a function",
    );
  });

  it("leaves plain text alone", () => {
    expect(stripAnsi("Ready on http://127.0.0.1:8791")).toBe("Ready on http://127.0.0.1:8791");
  });
});

describe("extractBootError", () => {
  // wrangler colourises even when piped, so escapes land mid-message and would
  // otherwise be reported as part of the error.
  it("returns a clean reason from colourised output", () => {
    expect(extractBootError(COLOURISED)).toBe(
      "Uncaught TypeError: coerce.boolean(...).meta is not a function",
    );
  });

  it("surfaces the uncaught error rather than the generic failure line", () => {
    expect(extractBootError(ZOD_CONFLICT_OUTPUT)).toBe(
      "Uncaught TypeError: coerce.boolean(...).meta is not a function",
    );
  });

  it("falls back to the generic message when there is no uncaught error", () => {
    expect(extractBootError("✘ [ERROR] The Workers runtime failed to start.")).toBe(
      "The Workers runtime failed to start",
    );
  });

  it("returns null when nothing looks like a failure", () => {
    expect(extractBootError("[wrangler:info] Ready on http://127.0.0.1:8791")).toBeNull();
  });
});

describe("isHealthyStatus", () => {
  it.each([200, 204, 299])("accepts %i", (status) => {
    expect(isHealthyStatus(status)).toBe(true);
  });

  // A listening-but-broken Worker is precisely what this gate must catch, so a
  // 5xx is a failure, not readiness.
  it.each([301, 400, 401, 404, 500, 502])("rejects %i", (status) => {
    expect(isHealthyStatus(status)).toBe(false);
  });
});

describe("targets", () => {
  it("covers both deployable Workers", () => {
    expect(BOOT_TARGETS.map((t) => t.name).sort()).toEqual(["@starter/mcp", "@starter/web"]);
  });

  it("polls paths that need no authentication", () => {
    // /api/v1/health and / are the only unauthenticated surfaces; anything else
    // would report a 401 and read as a boot failure.
    expect(BOOT_TARGETS.map((t) => t.path)).toEqual(["/api/v1/health", "/"]);
  });

  it("uses distinct ports so the two runs cannot collide", () => {
    const ports = BOOT_TARGETS.map((t) => t.port);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("builds a loopback url", () => {
    expect(healthUrl(BOOT_TARGETS[0])).toBe("http://127.0.0.1:8791/api/v1/health");
  });
});

/**
 * The second request, which is what makes a **binding** mistake fail the gate.
 * Readiness only proves the bundle starts; a binding renamed in wrangler.jsonc
 * leaves the runtime perfectly healthy and throws inside `parseEnv` on the
 * first request that reads it.
 */
describe("envProbe", () => {
  const target = (name: string) => BOOT_TARGETS.find((t) => t.name === name)!;

  /**
   * `/api/v1/health` already sits behind `authMiddleware`, so the readiness
   * request validates the web Worker's env on its own. A probe there would
   * assert nothing the first request has not already proved.
   */
  it("is absent for the web Worker, whose readiness path already validates the env", () => {
    expect(target("@starter/web").envProbe).toBeUndefined();
    expect(envProbeUrl(target("@starter/web"))).toBeNull();
  });

  /**
   * The MCP Worker answers `/` from static metadata on purpose — that route is
   * pinned env-independent — so without a second request nothing in CI would
   * ever reach `authFor`.
   */
  it("sends the mcp Worker at a route that reaches its auth env", () => {
    expect(target("@starter/mcp").envProbe).toBe("/api/auth/ok");
    expect(envProbeUrl(target("@starter/mcp"))).toBe("http://127.0.0.1:8792/api/auth/ok");
  });

  // The failure mode this guards is a *silent* one: repoint the probe at a
  // route that answers 200 without constructing auth — `/` being the obvious
  // candidate — and the check keeps passing while proving nothing at all.
  it("keeps the probe on the path prefix that constructs auth", () => {
    expect(target("@starter/mcp").envProbe).toMatch(/^\/api\/auth\//);
  });

  it("reuses its target's port, so the probe cannot address the wrong Worker", () => {
    for (const t of BOOT_TARGETS) {
      const url = envProbeUrl(t);
      if (url) expect(url).toContain(`:${t.port}`);
    }
  });
});

describe("summarize", () => {
  it("reports success with a count", () => {
    expect(summarize([], 2)).toContain("boot ok: 2 workers");
  });

  it("singularizes one worker", () => {
    expect(summarize([], 1)).toContain("1 worker started");
  });

  it("names each failing target and its reason", () => {
    const out = summarize([{ target: "@starter/web", reason: "Uncaught TypeError: boom" }], 2);

    expect(out).toContain("boot FAILED for 1 of 2");
    expect(out).toContain("@starter/web: Uncaught TypeError: boom");
  });

  it("spells out the consequence, so the failure is not dismissed as flaky", () => {
    expect(summarize([{ target: "@starter/web", reason: "x" }], 1)).toContain("deploy:web");
  });

  /**
   * A blocked target proves nothing about the bundle, so it must not borrow the
   * footer that says the bundle is broken.
   */
  it("does not claim the bundle is broken when the check could not run", () => {
    const out = summarize([{ target: "@starter/web", reason: "port busy", blocked: true }], 1);
    expect(out).toContain("nothing here says whether the bundle works");
    expect(out).not.toContain("deploy:web");
  });

  /**
   * The header carries the same claim as the footer, so it needs the same
   * assertion: checking only the footer let the two disagree once already —
   * `boot FAILED` printed directly above "the check did not run".
   */
  it("says BLOCKED, not FAILED, in the header of a blocked-only run", () => {
    const out = summarize([{ target: "@starter/web", reason: "port busy", blocked: true }], 2);
    expect(out).toContain("boot check BLOCKED for 1 of 2 worker(s):");
    expect(out).not.toContain("boot FAILED");
  });

  it("keeps the louder claim when a real failure sits beside a blocked one", () => {
    const out = summarize(
      [
        { target: "@starter/web", reason: "port busy", blocked: true },
        { target: "@starter/mcp", reason: "Uncaught TypeError: boom" },
      ],
      2,
    );
    expect(out).toContain("deploy:web");
    expect(out).toContain("boot FAILED");
    expect(out).not.toContain("BLOCKED");
  });
});

/**
 * The env the check runs under is the check's own, not the laptop's. `--var`
 * overrides a key but does not stop wrangler loading the rest of `.dev.vars`
 * underneath, so the `--env-file` half is what makes BOOT_VARS the whole env.
 */
describe("boot env", () => {
  it("hands wrangler an env file, without which .dev.vars is inherited", () => {
    expect(bootEnvArgs("/tmp/x.env")).toEqual(expect.arrayContaining(["--env-file", "/tmp/x.env"]));
  });

  it("names a fixture that .gitignore cannot swallow", () => {
    // `.env*` is ignored; a fixture matching it would exist locally and be
    // missing in CI — the exact skew this check exists to catch.
    expect(BOOT_ENV_FILE.startsWith(".env")).toBe(false);
  });

  /**
   * Asserting `BOOT_VARS` and `bootEnvArgs(file, {...})` separately leaves the
   * `= BOOT_VARS` default binding unexercised: it could be changed to `{}` with
   * every other test still green, and the Worker would inherit nothing at all —
   * a Worker with no secret serves no request, so the gate would assert "is CI
   * configured" rather than "does the bundle boot".
   */
  it("defaults to BOOT_VARS, the binding the check actually relies on", () => {
    expect(bootEnvArgs("/tmp/x.env")).toContain(
      `BETTER_AUTH_SECRET:${BOOT_VARS.BETTER_AUTH_SECRET}`,
    );
  });

  it("passes an empty value as a bare `KEY:`", () => {
    expect(bootVarArgs({ SENTRY_DSN: "" })).toEqual(["--var", "SENTRY_DSN:"]);
  });

  /**
   * Not a length assertion. Better Auth's own default is 38 characters and
   * cleared `.min(32)` for months (AGENTS.md, "Configuration"), so only the
   * real schema can say whether this value is accepted — and a secret the
   * schema rejects would fail every request with no pointer to the cause.
   */
  it("supplies a secret the env schema actually accepts", () => {
    const result = webEnvSchema.shape.BETTER_AUTH_SECRET.safeParse(BOOT_VARS.BETTER_AUTH_SECRET);
    expect(result.success).toBe(true);
  });

  it("would reject Better Auth's default, so the test above can fail", () => {
    const result = webEnvSchema.shape.BETTER_AUTH_SECRET.safeParse(
      "better-auth-secret-12345678901234567890",
    );
    expect(result.success).toBe(false);
  });
});

/**
 * The deny path for adopting a foreign Worker. The guard itself is one `fetch`
 * in `check-boot.ts`; what is worth pinning is that the refusal says which port
 * and how to find the process, since the failure it prevents is silent.
 */
describe("portOccupiedReason", () => {
  it("names the port and the command that finds the holder", () => {
    const reason = portOccupiedReason(BOOT_TARGETS[0]);
    expect(reason).toContain("8791");
    expect(reason).toContain("lsof -nP -iTCP:8791 -sTCP:LISTEN");
  });

  it("says the check would otherwise test the wrong process", () => {
    expect(portOccupiedReason(BOOT_TARGETS[0])).toContain("instead of the bundle just built");
  });
});
