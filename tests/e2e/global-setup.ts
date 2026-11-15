import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { mcpEnvSchema, webEnvSchema } from "@starter/config/env";

import {
  devVarsFacts,
  devVarsProblems,
  requiredDevVars,
} from "../../packages/cli/src/lib/dev-vars";

/*
 * Before anything else: are both Workers' dev vars in place?
 *
 * Without this, a missing file, an unset required key or two different
 * `BETTER_AUTH_SECRET` values surfaced minutes into the run as a locator
 * timeout in whichever spec reached the broken Worker first. The check lives
 * here because global setup runs before any spec and wherever the suite runs —
 * CI included, where it checks the two files the workflow has just written.
 *
 * Paths are relative to the working directory, the repository root, which
 * `pnpm db:reset` below already assumes.
 *
 * The file read and the database reset are injected so the control flow —
 * check first, reset only when nothing is wrong — is unit-tested, in
 * `packages/cli/src/__tests__/e2e-global-setup.test.ts`. A unit test must never
 * call the default export: it would reset a real database.
 */

export interface GlobalSetupDeps {
  /** The text of a dev-vars file, or `null` when it does not exist. */
  readDevVars: (file: string) => string | null;
  /** Drops the local database and re-applies every migration. */
  resetDatabase: () => void;
}

/** Each Worker's dev-vars file and the keys its own env schema requires in it. */
export const E2E_WORKERS: readonly { file: string; required: readonly string[] }[] = [
  { file: "apps/web/.dev.vars", required: requiredDevVars(webEnvSchema.shape) },
  { file: "apps/mcp/.dev.vars", required: requiredDevVars(mcpEnvSchema.shape) },
];

export function createGlobalSetup(deps: GlobalSetupDeps): () => void {
  return function globalSetup() {
    const problems = devVarsProblems(
      E2E_WORKERS.map(({ file, required }) => {
        // The text goes straight to the parser, which keeps key names and
        // fingerprints: nothing here ever holds a parsed value.
        const content = deps.readDevVars(file);
        return { file, required, facts: content === null ? null : devVarsFacts(content) };
      }),
    );

    if (problems.length > 0) {
      throw new Error(
        [
          "e2e cannot start: a Worker's dev vars are not in place.",
          ...problems.map((problem) => `  ${problem}`),
          "Names only: this check never prints a value.",
        ].join("\n"),
      );
    }

    deps.resetDatabase();
  };
}

export default createGlobalSetup({
  // Wrangler falls back to a dotenv file when this one is absent; the check deliberately does not.
  readDevVars: (file) => (existsSync(file) ? readFileSync(file, "utf8") : null),
  resetDatabase: () => {
    console.log("Resetting database for e2e tests...");
    execSync("pnpm db:reset", { stdio: "inherit" });
  },
});
