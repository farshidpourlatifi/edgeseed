/*
 * The control flow of `tests/e2e/global-setup.ts`, tested from here because of
 * who collects what: vitest picks up `packages/**` and `apps/**` only, while
 * Playwright runs any `*.test.ts` under `tests/e2e` as a spec. Here the file is
 * part of `pnpm test`, so the deny path is proven inside the fast gate.
 *
 * Only `createGlobalSetup` and `E2E_WORKERS` are imported. The default export is
 * the real pair of effects, and calling it would reset a real database.
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createGlobalSetup, E2E_WORKERS } from "../../../../tests/e2e/global-setup";
import { NON_DEV_VARS } from "../lib/dev-vars";

const WEB = "apps/web/.dev.vars";
const MCP = "apps/mcp/.dev.vars";
// Invented and low-entropy on purpose, and of two different lengths (41 and
// 57) so a printed length would show.
const SECRET_A = "invented-secret-" + "a".repeat(25);
const SECRET_B = "invented-secret-" + "b".repeat(41);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const requiredFor = (file: string) => E2E_WORKERS.find((worker) => worker.file === file)!.required;

/**
 * A file that sets every key its Worker requires, with `secret` as the shared
 * one. Built from the derived list, so a key a schema gains later needs no edit
 * here.
 */
const complete = (file: string, secret: string) =>
  requiredFor(file)
    .map((key) => `${key}=${key === "BETTER_AUTH_SECRET" ? secret : "http://localhost"}`)
    .join("\n");

const setupWith = (files: Record<string, string>) => {
  const resetDatabase = vi.fn();
  const run = createGlobalSetup({ readDevVars: (file) => files[file] ?? null, resetDatabase });
  return { run, resetDatabase };
};

/** The message the setup threw, or `""` when it did not throw. */
const refusal = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("e2e global setup", () => {
  it("should refuse, naming each missing file, and never reset the database", () => {
    const { run, resetDatabase } = setupWith({});

    const message = refusal(run);

    expect(message).toContain(`${WEB} is missing`);
    expect(message).toContain(`${MCP} is missing`);
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(resetDatabase).not.toHaveBeenCalled();
  });

  it("should refuse two different secrets without a value, a fingerprint or a length", () => {
    const { run, resetDatabase } = setupWith({
      [WEB]: complete(WEB, SECRET_A),
      [MCP]: complete(MCP, SECRET_B),
    });

    const message = refusal(run);

    expect(message).toContain(`BETTER_AUTH_SECRET differs between ${WEB} and ${MCP}`);
    for (const secret of [SECRET_A, SECRET_B]) {
      expect(message).not.toContain(secret);
      expect(message).not.toContain(sha256(secret));
      expect(message).not.toContain(String(secret.length));
    }
    expect(resetDatabase).not.toHaveBeenCalled();
  });

  it("should reset the database once when both files are complete and agree", () => {
    const { run, resetDatabase } = setupWith({
      [WEB]: complete(WEB, SECRET_A),
      [MCP]: complete(MCP, SECRET_A),
    });

    expect(refusal(run)).toBe("");
    expect(resetDatabase).toHaveBeenCalledTimes(1);
  });

  it("should derive each Worker's required keys from its real schema", () => {
    expect(E2E_WORKERS.map((worker) => worker.file)).toEqual([WEB, MCP]);
    expect(requiredFor(WEB)).toEqual(
      expect.arrayContaining(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]),
    );
    expect(requiredFor(MCP)).toContain("BETTER_AUTH_SECRET");
    expect(requiredFor(MCP)).not.toContain("BETTER_AUTH_URL");
    for (const key of [...NON_DEV_VARS, "LOG_LEVEL"]) {
      expect(requiredFor(WEB)).not.toContain(key);
      expect(requiredFor(MCP)).not.toContain(key);
    }
  });
});
