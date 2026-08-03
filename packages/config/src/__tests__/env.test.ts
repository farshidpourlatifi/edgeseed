import { describe, it, expect } from "vitest";
import { createFakeEnv } from "@starter/cli/test-helpers/fake-env";
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

  it("rejects a non-URL BETTER_AUTH_URL", () => {
    expect(() => parseEnv(webEnvSchema, createFakeEnv({ BETTER_AUTH_URL: "not-a-url" }))).toThrow();
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
