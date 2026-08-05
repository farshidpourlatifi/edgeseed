import { describe, it, expect } from "vitest";
import {
  compareEnvExample,
  exampleKeys,
  schemaBlockKeys,
  undocumentedScripts,
} from "../lib/docs-sync";

const ENV_SOURCE = [
  "const sharedEnvSchema = z.object({",
  '  DB: z.custom<D1Database>((v) => v != null, "D1 binding required"),',
  "  BETTER_AUTH_SECRET: z.string().min(32),",
  '  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),',
  "});",
  "",
  "export const webEnvSchema = sharedEnvSchema.extend({",
  "  BETTER_AUTH_URL: z.string().url(),",
  "});",
  "",
  "export const mcpEnvSchema = sharedEnvSchema.extend({});",
].join("\n");

describe("undocumentedScripts", () => {
  it("should report a script the doc never mentions", () => {
    expect(undocumentedScripts(["db:migrate", "verify"], "run `pnpm verify` before")).toEqual([
      "db:migrate",
    ]);
  });

  it("should not count a longer script as documenting its prefix", () => {
    expect(undocumentedScripts(["test"], "run `pnpm test:e2e` for the suite")).toEqual(["test"]);
  });

  it("should not count prose containing the bare script name", () => {
    expect(undocumentedScripts(["build"], "check the build output directory")).toEqual(["build"]);
  });

  it("should accept the full command at a word boundary", () => {
    expect(undocumentedScripts(["test", "build"], "| `pnpm test` |\npnpm build\n")).toEqual([]);
  });
});

describe("schemaBlockKeys", () => {
  it("should extract the shared block's keys", () => {
    expect(schemaBlockKeys(ENV_SOURCE, "sharedEnvSchema")).toEqual([
      "DB",
      "BETTER_AUTH_SECRET",
      "LOG_LEVEL",
    ]);
  });

  it("should extract only an app block's own keys", () => {
    expect(schemaBlockKeys(ENV_SOURCE, "webEnvSchema")).toEqual(["BETTER_AUTH_URL"]);
    expect(schemaBlockKeys(ENV_SOURCE, "mcpEnvSchema")).toEqual([]);
  });

  it("should return nothing for an unknown block name", () => {
    expect(schemaBlockKeys(ENV_SOURCE, "missingSchema")).toEqual([]);
  });
});

describe("exampleKeys", () => {
  it("should read live keys", () => {
    expect(exampleKeys("BETTER_AUTH_SECRET=abc\nSENTRY_DSN=\n")).toEqual(
      new Set(["BETTER_AUTH_SECRET", "SENTRY_DSN"]),
    );
  });

  it("should read commented placeholder keys", () => {
    expect(exampleKeys("# LOG_LEVEL=debug\n")).toEqual(new Set(["LOG_LEVEL"]));
  });

  it("should not read prose comments", () => {
    expect(exampleKeys("# Required — public origin of this app\n# See docs/README.md\n")).toEqual(
      new Set(),
    );
  });
});

describe("compareEnvExample", () => {
  it("should report a schema key missing from the example", () => {
    const drift = compareEnvExample(["A", "B"], new Set(["A"]));
    expect(drift.missing).toEqual(["B"]);
    expect(drift.unknown).toEqual([]);
  });

  it("should report an example key the schema does not know", () => {
    const drift = compareEnvExample(["A"], new Set(["A", "BOGUS"]));
    expect(drift.missing).toEqual([]);
    expect(drift.unknown).toEqual(["BOGUS"]);
  });

  it("should report no drift when the key sets match", () => {
    expect(compareEnvExample(["A", "B"], new Set(["B", "A"]))).toEqual({
      missing: [],
      unknown: [],
    });
  });
});
