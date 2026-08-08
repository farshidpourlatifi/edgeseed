import { describe, it, expect } from "vitest";
import { createFakeEnv } from "@starter/testing/fake-env";
import { parseEnv, webEnvSchema, mcpEnvSchema } from "../env";

describe("env schemas", () => {
  it("parses a valid env", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv());
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:5173");
    expect(env.ENVIRONMENT).toBe("development");
  });

  it("defaults ENVIRONMENT to development when absent", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv({ ENVIRONMENT: undefined }));
    expect(env.ENVIRONMENT).toBe("development");
  });

  it("rejects an unknown ENVIRONMENT value", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ ENVIRONMENT: "prod" }))).toThrow();
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 chars", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_SECRET: "short" }))).toThrow();
  });

  it("rejects a missing BETTER_AUTH_SECRET", () => {
    expect(() =>
      parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_SECRET: undefined })),
    ).toThrow();
  });

  // The value that ships when nobody ran `wrangler secret put`. It is 38 chars,
  // so length alone accepts it — this case is the whole point of the refine.
  it("rejects Better Auth's built-in default secret", () => {
    expect(() =>
      parseEnv(
        webEnvSchema,
        createFakeEnv({ BETTER_AUTH_SECRET: "better-auth-secret-12345678901234567890" }),
      ),
    ).toThrow(/built-in default/);
  });

  it("rejects Better Auth's default secret for the mcp schema too", () => {
    expect(() =>
      parseEnv(
        mcpEnvSchema,
        createFakeEnv({ BETTER_AUTH_SECRET: "better-auth-secret-12345678901234567890" }),
      ),
    ).toThrow(/built-in default/);
  });

  it("accepts a real secret of exactly 32 chars", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_SECRET: "a".repeat(32) }));
    expect(env.BETTER_AUTH_SECRET).toBe("a".repeat(32));
  });
});

/**
 * Audit #4. These are required rather than optional so a Worker deployed
 * without them serves nothing, instead of serving an unthrottled auth surface —
 * the same fail-closed reasoning as the secret in #3.
 */
describe("rate-limit bindings", () => {
  const BINDINGS = ["RATE_LIMIT_DEFAULT", "RATE_LIMIT_CREDENTIALS", "RATE_LIMIT_MAIL"] as const;

  it.each(BINDINGS)("rejects an env with no %s binding", (binding) => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ [binding]: undefined }))).toThrow(
      new RegExp(binding),
    );
  });

  it.each(BINDINGS)("requires %s on the mcp Worker too", (binding) => {
    // Same Better Auth, same users, same secret — this Worker cannot be the
    // side without a limiter.
    expect(() => parseEnv(mcpEnvSchema, createFakeEnv({ [binding]: undefined }))).toThrow(
      new RegExp(binding),
    );
  });

  /**
   * The realistic failure is a *misnamed* binding, not an absent one: wrangler
   * deploys a Worker whose binding names do not match the code without
   * complaint, and a presence-only check would accept whatever landed there.
   */
  it("rejects a binding that is present but is not a rate limiter", () => {
    expect(() =>
      parseEnv(webEnvSchema, createFakeEnv({ RATE_LIMIT_MAIL: { id: "some-kv-namespace" } })),
    ).toThrow(/RATE_LIMIT_MAIL/);
  });
});

/**
 * The MCP Worker cannot issue or honour an OAuth grant without somewhere to
 * store it. It was typed ad hoc in `apps/mcp/src/env.ts` for months, and a type
 * is not a check — a rename in wrangler.jsonc compiled, deployed and passed the
 * gate, and only the OAuth flow noticed.
 */
describe("the OAUTH_KV binding", () => {
  it("is required by the mcp schema", () => {
    expect(() => parseEnv(mcpEnvSchema, createFakeEnv({ OAUTH_KV: undefined }))).toThrow(
      /OAUTH_KV/,
    );
  });

  it("rejects something bound under the name that is not a KV namespace", () => {
    expect(() => parseEnv(mcpEnvSchema, createFakeEnv({ OAUTH_KV: { limit: () => {} } }))).toThrow(
      /OAUTH_KV/,
    );
  });

  /**
   * The near-miss, and the reason the check is not just `get` + `put`: an
   * `R2Bucket` has both, plus `delete` and `list`. Bound under this name it
   * would have passed validation, kept `check:boot` green, and failed only when
   * the OAuth provider tried to store a real grant. `getWithMetadata` is the
   * member R2 does not have.
   */
  it("rejects an R2 bucket bound under the name", () => {
    const r2Shaped = {
      get: () => {},
      put: () => {},
      delete: () => {},
      list: () => {},
      head: () => {},
      createMultipartUpload: () => {},
    };

    expect(() => parseEnv(mcpEnvSchema, createFakeEnv({ OAUTH_KV: r2Shaped }))).toThrow(/OAUTH_KV/);
  });

  it("accepts a real namespace", () => {
    expect(() => parseEnv(mcpEnvSchema, createFakeEnv())).not.toThrow();
  });

  // The web Worker binds no KV at all, so requiring it there would refuse every
  // request on the app that actually serves users.
  it("is not required by the web schema", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ OAUTH_KV: undefined }))).not.toThrow();
  });
});

/**
 * `.dev.vars` spells an unset optional key as `KEY=`, which arrives as `""`,
 * not as absent — and every optional key in `.dev.vars.example` ships that way.
 * Since the env is validated on every request, treating `""` as a value meant a
 * 500 on the documented setup path.
 */
describe("blank optional bindings", () => {
  const blankable = [
    "MARKETING_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SENTRY_DSN",
    "SENTRY_ENVIRONMENT",
    "SENTRY_RELEASE",
    "SENTRY_TRACES_SAMPLE_RATE",
    "LOG_LEVEL",
  ] as const;

  it.each(blankable)("treats an empty %s as unset", (key) => {
    const env = parseEnv(webEnvSchema, createFakeEnv({ [key]: "" })) as Record<string, unknown>;
    expect(env[key]).toBeUndefined();
  });

  it("parses an env with every optional key blank, as the example file ships it", () => {
    const blanks = Object.fromEntries(blankable.map((key) => [key, ""]));
    expect(() => parseEnv(webEnvSchema, createFakeEnv(blanks))).not.toThrow();
  });

  it("falls back to the ENVIRONMENT default when it is blank", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv({ ENVIRONMENT: "" }));
    expect(env.ENVIRONMENT).toBe("development");
  });

  // Blank still means missing for the two that are required — an empty secret is
  // exactly the case #3 exists to refuse, not a value to wave through.
  it.each(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])("still rejects a blank %s", (key) => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ [key]: "" }))).toThrow();
  });

  it("still rejects a malformed value that is not blank", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ MARKETING_URL: "not-a-url" }))).toThrow();
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ LOG_LEVEL: "loud" }))).toThrow();
  });
});

describe("env schemas, continued", () => {
  it("rejects a non-URL BETTER_AUTH_URL", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_URL: "not-a-url" }))).toThrow();
  });

  it("web schema rejects a missing BETTER_AUTH_URL", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_URL: undefined }))).toThrow();
  });

  it("mcp schema does not require BETTER_AUTH_URL — origin derives per request", () => {
    expect(() =>
      parseEnv(mcpEnvSchema, createFakeEnv({ BETTER_AUTH_URL: undefined })),
    ).not.toThrow();
  });

  it("rejects a missing DB binding", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ DB: null }))).toThrow(/D1 binding/);
  });

  it("treats social login credentials as optional", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv());
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();

    const withGithub = parseEnv(
      webEnvSchema,
      createFakeEnv({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" }),
    );
    expect(withGithub.GITHUB_CLIENT_ID).toBe("id");
  });

  it("mcp schema accepts the shared shape", () => {
    expect(() => parseEnv(mcpEnvSchema, createFakeEnv())).not.toThrow();
  });
});

describe("observability env", () => {
  it("treats every observability var as optional — Sentry is opt-in", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv());
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBeUndefined();
    expect(env.LOG_LEVEL).toBeUndefined();
  });

  it("accepts a DSN and the tag overrides", () => {
    const env = parseEnv(
      webEnvSchema,
      createFakeEnv({
        SENTRY_DSN: "https://key@o0.ingest.sentry.io/0",
        SENTRY_ENVIRONMENT: "canary",
        SENTRY_RELEASE: "web@9.9.9",
      }),
    );
    expect(env.SENTRY_DSN).toBe("https://key@o0.ingest.sentry.io/0");
    expect(env.SENTRY_ENVIRONMENT).toBe("canary");
    expect(env.SENTRY_RELEASE).toBe("web@9.9.9");
  });

  // Worker bindings arrive as strings, so the rate must coerce.
  it("coerces SENTRY_TRACES_SAMPLE_RATE from a string", () => {
    const env = parseEnv(webEnvSchema, createFakeEnv({ SENTRY_TRACES_SAMPLE_RATE: "0.25" }));
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.25);
  });

  it("accepts the inclusive sample-rate bounds", () => {
    expect(
      parseEnv(webEnvSchema, createFakeEnv({ SENTRY_TRACES_SAMPLE_RATE: "0" }))
        .SENTRY_TRACES_SAMPLE_RATE,
    ).toBe(0);
    expect(
      parseEnv(webEnvSchema, createFakeEnv({ SENTRY_TRACES_SAMPLE_RATE: "1" }))
        .SENTRY_TRACES_SAMPLE_RATE,
    ).toBe(1);
  });

  it.each(["-0.1", "1.5", "abc"])(
    "rejects an out-of-range or unparseable sample rate (%s)",
    (value) => {
      expect(() =>
        parseEnv(webEnvSchema, createFakeEnv({ SENTRY_TRACES_SAMPLE_RATE: value })),
      ).toThrow();
    },
  );

  it("accepts each valid LOG_LEVEL", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(parseEnv(webEnvSchema, createFakeEnv({ LOG_LEVEL: level })).LOG_LEVEL).toBe(level);
    }
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ LOG_LEVEL: "trace" }))).toThrow();
  });

  it("mcp schema carries the observability vars too", () => {
    const env = parseEnv(mcpEnvSchema, createFakeEnv({ LOG_LEVEL: "warn" }));
    expect(env.LOG_LEVEL).toBe("warn");
  });
});
