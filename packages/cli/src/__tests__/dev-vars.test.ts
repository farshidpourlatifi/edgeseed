import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  devVarsFacts,
  devVarsProblems,
  requiredDevVars,
  type EnvShape,
  type WorkerDevVars,
} from "../lib/dev-vars";

const WEB = "apps/web/.dev.vars";
const MCP = "apps/mcp/.dev.vars";
// Invented and low-entropy on purpose (a repeated letter, so no secret scanner
// reads them as credentials), and of two different lengths (41 and 57) so a
// printed length would show.
const SECRET_A = "invented-secret-" + "a".repeat(25);
const SECRET_B = "invented-secret-" + "b".repeat(41);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const field = (acceptsUndefined: boolean) => ({
  safeParse: (value: unknown) => ({ success: value !== undefined || acceptsUndefined }),
});

const worker = (file: string, required: string[], content: string | null): WorkerDevVars => ({
  file,
  required,
  facts: content === null ? null : devVarsFacts(content),
});

describe("requiredDevVars", () => {
  it("should keep, in shape order, the fields that reject undefined and are not bindings", () => {
    const shape: EnvShape = {
      SECOND_REQUIRED: field(false),
      OPTIONAL: field(true),
      A_BINDING: field(false),
      FIRST_REQUIRED: field(false),
    };

    expect(requiredDevVars(shape, new Set(["A_BINDING"]))).toEqual([
      "SECOND_REQUIRED",
      "FIRST_REQUIRED",
    ]);
  });

  it("should leave out the Wrangler-provided bindings by default", () => {
    expect(requiredDevVars({ DB: field(false), BETTER_AUTH_SECRET: field(false) })).toEqual([
      "BETTER_AUTH_SECRET",
    ]);
  });
});

describe("devVarsFacts", () => {
  it("should fingerprint a quoted and an unquoted spelling of one value alike", () => {
    expect(devVarsFacts('KEY="v"').get("KEY")).toBe(devVarsFacts("KEY=v").get("KEY"));
    expect(devVarsFacts("KEY=v").get("KEY")).toBe(sha256("v"));
    expect(devVarsFacts("KEY=v").get("KEY")).not.toBe(devVarsFacts("KEY=w").get("KEY"));
  });

  it("should read an export line and skip a commented one", () => {
    const facts = devVarsFacts("export KEY=v\n# HIDDEN=v\n");

    expect(facts.get("KEY")).toBe(sha256("v"));
    expect(facts.has("HIDDEN")).toBe(false);
  });

  it("should map an empty value to null", () => {
    const facts = devVarsFacts("KEY=\n");

    expect(facts.has("KEY")).toBe(true);
    expect(facts.get("KEY")).toBeNull();
  });
});

describe("devVarsProblems", () => {
  it("should report a missing file once, with its required keys and no per-key line", () => {
    expect(devVarsProblems([worker(WEB, ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"], null)])).toEqual(
      [
        `${WEB} is missing. Copy ${WEB}.example to ${WEB} and set: BETTER_AUTH_SECRET, BETTER_AUTH_URL.`,
      ],
    );
  });

  it("should report a required key that is absent and one that is empty, and no optional key", () => {
    const content = "BETTER_AUTH_URL=\nSENTRY_DSN=\n";

    expect(
      devVarsProblems([worker(WEB, ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"], content)]),
    ).toEqual([
      `${WEB} has no value for BETTER_AUTH_SECRET.`,
      `${WEB} has no value for BETTER_AUTH_URL.`,
    ]);
  });

  it("should report every required key of a file that exists but is empty", () => {
    expect(devVarsProblems([worker(MCP, ["BETTER_AUTH_SECRET"], "")])).toEqual([
      `${MCP} has no value for BETTER_AUTH_SECRET.`,
    ]);
  });

  it("should report a shared key whose value differs, naming both files", () => {
    expect(
      devVarsProblems([
        worker(WEB, ["BETTER_AUTH_SECRET"], `BETTER_AUTH_SECRET=${SECRET_A}\n`),
        worker(MCP, ["BETTER_AUTH_SECRET"], `BETTER_AUTH_SECRET=${SECRET_B}\n`),
      ]),
    ).toEqual([
      `BETTER_AUTH_SECRET differs between ${WEB} and ${MCP}. Use one value in both: ` +
        `the two Workers share one database and one user set.`,
    ]);
  });

  it("should report nothing when both files carry one value", () => {
    expect(
      devVarsProblems([
        worker(WEB, ["BETTER_AUTH_SECRET"], `BETTER_AUTH_SECRET=${SECRET_A}\n`),
        worker(MCP, ["BETTER_AUTH_SECRET"], `BETTER_AUTH_SECRET="${SECRET_A}"\n`),
      ]),
    ).toEqual([]);
  });

  it("should not call a shared key different when one file lacks it", () => {
    expect(
      devVarsProblems([
        worker(WEB, ["BETTER_AUTH_SECRET"], `BETTER_AUTH_SECRET=${SECRET_A}\n`),
        worker(MCP, ["BETTER_AUTH_SECRET"], "BETTER_AUTH_SECRET=\n"),
      ]),
    ).toEqual([`${MCP} has no value for BETTER_AUTH_SECRET.`]);
  });

  it("should compare only the keys named as shared", () => {
    const workers = [
      worker(WEB, ["OTHER"], `OTHER=${SECRET_A}\n`),
      worker(MCP, ["OTHER"], `OTHER=${SECRET_B}\n`),
    ];

    expect(devVarsProblems(workers)).toEqual([]);
    expect(devVarsProblems(workers, ["OTHER"])).toEqual([
      `OTHER differs between ${WEB} and ${MCP}. Use one value in both: ` +
        `the two Workers share one database and one user set.`,
    ]);
  });

  it("should refuse a worker with no required keys as a broken scan, file present or not", () => {
    const line = `No required keys were derived for ${WEB} — the scan is broken, not the file.`;

    expect(devVarsProblems([worker(WEB, [], `BETTER_AUTH_SECRET=${SECRET_A}\n`)])).toEqual([line]);
    expect(devVarsProblems([worker(WEB, [], null)])).toEqual([line]);
  });

  it("should never put a value, a fingerprint or a length into a message", () => {
    const webContent = `BETTER_AUTH_SECRET=${SECRET_A}\n`;
    const mcpContent = `BETTER_AUTH_SECRET=${SECRET_B}\n`;
    const joined = devVarsProblems([
      worker(WEB, ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"], webContent),
      worker(MCP, ["BETTER_AUTH_SECRET"], mcpContent),
    ]).join("\n");

    expect(joined).toContain("has no value for BETTER_AUTH_URL");
    expect(joined).toContain("differs between");
    for (const secret of [SECRET_A, SECRET_B]) {
      expect(joined).not.toContain(secret);
      expect(joined).not.toContain(sha256(secret));
    }
    // These file names and keys hold no digit, so one would be a length or a
    // fingerprint.
    expect(joined).not.toMatch(/\d/);

    for (const [content, secret] of [
      [webContent, SECRET_A],
      [mcpContent, SECRET_B],
    ]) {
      expect(JSON.stringify([...devVarsFacts(content)])).not.toContain(secret);
    }
  });
});
