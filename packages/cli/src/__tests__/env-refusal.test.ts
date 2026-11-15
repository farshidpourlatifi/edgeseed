import { describe, expect, it } from "vitest";

import {
  envRefusalMessage,
  outputTail,
  REFUSAL_QUIET_MS,
  REFUSAL_SETTLE_CAP_MS,
  refusalOutputSettled,
  refusedEnvKeys,
} from "../lib/env-refusal";

const issue = (key: string) => [
  "      '  {\\n' +",
  '      \'    "expected": "string",\\n\' +',
  '      \'    "code": "invalid_type",\\n\' +',
  "      '    \"path\": [\\n' +",
  `      '      "${key}"\\n' +`,
  "      '    ],\\n' +",
  '      \'    "message": "Invalid input: expected string, received undefined"\\n\' +',
  "      '  }\\n' +",
];

/** A rejected env as the Worker prints it: the error header, then the issues. */
const zodBlock = (...keys: string[]) => [
  "\u001b[31m✘ \u001b[41;31m[\u001b[41;97mERROR\u001b[41;31m]\u001b[0m \u001b[1mZodError\u001b[0m",
  "    message: '[\\n' +",
  ...keys.flatMap(issue),
  "      ']'",
];

const BANNER = 'env.BETTER_AUTH_SECRET ("(hidden)")      Environment Variable      local';
const COMPLETE = "  path: '/api/auth/ok', status: 500, msg: 'request.complete'";

const FIXTURE = [BANNER, ...zodBlock("BETTER_AUTH_SECRET"), "", COMPLETE].join("\n");
const NO_KEY_OUTPUT = [BANNER, COMPLETE].join("\n");

const message = (status: number, output: string) =>
  envRefusalMessage({
    origin: "http://127.0.0.1:8788",
    probe: "/api/auth/ok",
    status,
    devVarsFile: "apps/mcp/.dev.vars",
    wranglerFile: "apps/mcp/wrangler.jsonc",
    output,
  });

describe("refusedEnvKeys", () => {
  it("should name the key the env schema rejected, and nothing from a request path", () => {
    expect(refusedEnvKeys(FIXTURE)).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("should name every rejected key once, in order", () => {
    const output = zodBlock("BETTER_AUTH_SECRET", "OAUTH_KV", "BETTER_AUTH_SECRET").join("\n");

    expect(refusedEnvKeys(output)).toEqual(["BETTER_AUTH_SECRET", "OAUTH_KV"]);
  });

  it("should read only the last rejection", () => {
    const output = [...zodBlock("BETTER_AUTH_SECRET"), COMPLETE, ...zodBlock("OAUTH_KV")].join(
      "\n",
    );

    expect(refusedEnvKeys(output)).toEqual(["OAUTH_KV"]);
  });

  it("should name nothing when the output holds no rejection", () => {
    expect(refusedEnvKeys(NO_KEY_OUTPUT)).toEqual([]);
    expect(refusedEnvKeys("")).toEqual([]);
  });
});

describe("outputTail", () => {
  it("should keep the last 40 lines by default and drop empty ones", () => {
    const numbered = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`);
    const tail = outputTail(numbered.join("\n\n  \n")).split("\n");

    expect(tail).toHaveLength(40);
    expect(tail[0]).toBe("line 21");
    expect(tail.at(-1)).toBe("line 60");
  });

  it("should keep as many lines as it is asked for, without colour codes", () => {
    expect(outputTail("one\n\u001b[31mtwo\u001b[0m\nthree\n", 2)).toBe("two\nthree");
  });
});

describe("envRefusalMessage", () => {
  it("should name the rejected key and both files for a 5xx whose output names one", () => {
    expect(message(500, FIXTURE).split("\n").slice(0, 4)).toEqual([
      "The MCP Worker is listening on http://127.0.0.1:8788 but refused GET /api/auth/ok (HTTP 500): its env did not parse.",
      "Rejected: BETTER_AUTH_SECRET.",
      "Dev vars are set in apps/mcp/.dev.vars (template: apps/mcp/.dev.vars.example); bindings are named in apps/mcp/wrangler.jsonc.",
      "The Worker's output, last lines:",
    ]);
    expect(message(500, FIXTURE).split("\n").at(-1)).toBe(COMPLETE);
    expect(message(500, FIXTURE)).toContain("✘ [ERROR] ZodError");
    expect(message(500, FIXTURE)).not.toContain("\u001b");
  });

  it("should list every rejected key", () => {
    const output = zodBlock("BETTER_AUTH_SECRET", "OAUTH_KV").join("\n");

    expect(message(503, output)).toContain("(HTTP 503)");
    expect(message(503, output)).toContain("Rejected: BETTER_AUTH_SECRET, OAUTH_KV.");
  });

  it("should not claim a parse failure for a 5xx whose output names no key", () => {
    const text = message(500, NO_KEY_OUTPUT);

    expect(text.split("\n").slice(0, 3)).toEqual([
      "The MCP Worker is listening on http://127.0.0.1:8788 but answered GET /api/auth/ok with HTTP 500, and its output names no rejected env key.",
      "Dev vars are set in apps/mcp/.dev.vars (template: apps/mcp/.dev.vars.example); bindings are named in apps/mcp/wrangler.jsonc.",
      "The Worker's output, last lines:",
    ]);
    expect(text).not.toContain("Rejected:");
    expect(text).not.toContain("did not parse");
    expect(text.split("\n").at(-1)).toBe(COMPLETE);
  });

  it("should blame the probe route, not the env, for a status below 500", () => {
    const text = message(404, FIXTURE);

    expect(text.split("\n").slice(0, 2)).toEqual([
      "The MCP Worker answered GET /api/auth/ok with HTTP 404. A 4xx here usually means the probe route moved, not that the env is wrong.",
      "The Worker's output, last lines:",
    ]);
    expect(text.split("\n").at(-1)).toBe(COMPLETE);
    expect(text).not.toContain("did not parse");
    expect(text).not.toContain("Rejected:");
    expect(text).not.toContain("apps/mcp/.dev.vars");
  });

  it("should treat 499 as a route answer and 500 as an env answer", () => {
    expect(message(499, FIXTURE)).toContain("the probe route moved");
    expect(message(500, FIXTURE)).not.toContain("the probe route moved");
  });
});

describe("refusalOutputSettled", () => {
  const settled = (status: number, output: string, quietMs: number, waitedMs = quietMs) =>
    refusalOutputSettled({ status, output, quietMs, waitedMs });

  it("should settle a 5xx once its output names a key and has been quiet long enough", () => {
    expect(settled(500, FIXTURE, REFUSAL_QUIET_MS)).toBe(true);
  });

  it("should not settle while the output is still arriving", () => {
    expect(settled(500, FIXTURE, REFUSAL_QUIET_MS - 1)).toBe(false);
  });

  it("should keep waiting for a 5xx whose rejection has not been printed yet", () => {
    expect(settled(500, NO_KEY_OUTPUT, REFUSAL_SETTLE_CAP_MS - 1)).toBe(false);
  });

  it("should settle at the cap whatever the output says", () => {
    expect(settled(500, NO_KEY_OUTPUT, 0, REFUSAL_SETTLE_CAP_MS)).toBe(true);
  });

  it("should settle a status below 500 on quiet alone", () => {
    expect(settled(404, NO_KEY_OUTPUT, REFUSAL_QUIET_MS)).toBe(true);
    expect(settled(499, NO_KEY_OUTPUT, REFUSAL_QUIET_MS)).toBe(true);
    expect(settled(404, NO_KEY_OUTPUT, REFUSAL_QUIET_MS - 1)).toBe(false);
  });
});
