import { describe, it, expect } from "vitest";
import {
  brokenRelativeLinks,
  compareEnvExample,
  exampleKeys,
  mcpToolNames,
  relativeLinkTargets,
  schemaBlockKeys,
  undocumentedNames,
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

  /**
   * The block used to end at the first `;` anywhere, so one inside a comment
   * cut it short — and every key below reported as "absent from env.ts" while
   * sitting there in plain sight. Keys are indented; the statement's closing
   * `});` is not, which is the distinction the scan relies on.
   */
  it("should not end the block at a semicolon inside a comment", () => {
    const withComment = [
      "const sharedEnvSchema = z.object({",
      "  DB: z.custom<D1Database>((v) => v != null, `D1 binding required`),",
      "  // see rate-limit.ts; the numbers there are canonical",
      "  RATE_LIMIT_MAIL: rateLimitBinding(),",
      "});",
    ].join("\n");

    expect(schemaBlockKeys(withComment, "sharedEnvSchema")).toEqual(["DB", "RATE_LIMIT_MAIL"]);
  });

  it("should stop at the end of the block, not run into the next declaration", () => {
    expect(schemaBlockKeys(ENV_SOURCE, "sharedEnvSchema")).not.toContain("BETTER_AUTH_URL");
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

describe("relativeLinkTargets", () => {
  it("should read a relative link and a relative image", () => {
    expect(
      relativeLinkTargets("see [docs](./docs/mcp.md) and ![shot](docs/assets/a.webp)"),
    ).toEqual(["./docs/mcp.md", "docs/assets/a.webp"]);
  });

  it("should skip absolute URLs and in-page anchors", () => {
    const doc = "[site](https://edgeseed.dev) [mail](mailto:a@b.c) [top](#quick-start)";
    expect(relativeLinkTargets(doc)).toEqual([]);
  });

  it("should skip protocol-relative URLs", () => {
    expect(relativeLinkTargets("[cdn](//example.com/x.png)")).toEqual([]);
  });

  it("should strip an anchor so the file is what gets resolved", () => {
    expect(relativeLinkTargets("[x](./AGENTS.md#cutting-a-release)")).toEqual(["./AGENTS.md"]);
  });

  it("should drop a link title", () => {
    expect(relativeLinkTargets('[x](./LICENSE "The license")')).toEqual(["./LICENSE"]);
  });

  it("should unwrap an angle-bracket destination", () => {
    expect(relativeLinkTargets("[x](<./docs/a b.md>)")).toEqual(["./docs/a b.md"]);
  });

  it("should decode a percent-encoded path", () => {
    expect(relativeLinkTargets("[x](./docs/a%20b.md)")).toEqual(["./docs/a b.md"]);
  });
});

describe("brokenRelativeLinks", () => {
  it("should report a target that does not exist", () => {
    const doc = "[gone](./docs/removed.md) and [here](./README.md)";
    expect(brokenRelativeLinks(doc, (t) => t === "./README.md")).toEqual(["./docs/removed.md"]);
  });

  it("should report nothing when every target resolves", () => {
    expect(brokenRelativeLinks("[a](./a.md) [b](./b.md)", () => true)).toEqual([]);
  });

  it("should report a repeated broken target once", () => {
    const doc = "[a](./gone.md) then [again](./gone.md)";
    expect(brokenRelativeLinks(doc, () => false)).toEqual(["./gone.md"]);
  });
});

describe("mcpToolNames", () => {
  it("should read the registered name, not the exported function name", () => {
    const src = [
      "export function registerHealthTool(server: McpServer) {",
      '  server.tool("health_check", "Check the health status", {}, async () => ({}));',
      "}",
    ].join("\n");
    expect(mcpToolNames([src])).toEqual(["health_check"]);
  });

  it("should read tools across several sources", () => {
    expect(mcpToolNames(['server.tool("a", ...', "server.tool(\n  'b',"])).toEqual(["a", "b"]);
  });

  it("should find nothing in a source that registers no tool", () => {
    expect(mcpToolNames(["export interface ToolContext { db: Database }"])).toEqual([]);
  });
});

describe("undocumentedNames", () => {
  it("should report a name the doc never mentions", () => {
    expect(undocumentedNames(["health_check", "whoami"], "tools are `health_check`")).toEqual([
      "whoami",
    ]);
  });

  it("should report nothing when the doc mentions all of them", () => {
    expect(undocumentedNames(["/me", "/tokens"], "| `GET /me` | `POST /tokens` |")).toEqual([]);
  });

  it("should report a duplicated missing name once", () => {
    expect(undocumentedNames(["/me", "/me"], "nothing here")).toEqual(["/me"]);
  });
});
