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
