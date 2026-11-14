import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `wrangler d1 migrations apply` asks "continue?" whenever its stdin and stdout
 * are both terminals, and waits. A `db:*` script that hands its own stdin on
 * therefore blocks whatever ran it from a terminal — `pnpm test:e2e` sat in
 * global-setup on that prompt, buried under Playwright's output, while CI (no
 * TTY) never saw it (issue #97).
 *
 * The scripts are run for real, against a stand-in `pnpm` that reports what it
 * could read from stdin. Reading nothing is the property: a process that cannot
 * read the caller's stdin cannot wait on it. No pty is needed to tell the two
 * apart, so the case is the same on a laptop and in CI.
 */
const SCRIPTS = join(import.meta.dirname, "..");
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const TYPED = "typed-by-the-caller";

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "db-scripts-"));
  const pnpm = join(sandbox, "pnpm");
  writeFileSync(
    pnpm,
    [
      "#!/bin/sh",
      'echo "argv=[$*]"',
      'echo "stdin=[$(/bin/cat)]"',
      'echo "on-stderr" >&2',
      "",
    ].join("\n"),
  );
  chmodSync(pnpm, 0o755);
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// `cwd` is the sandbox because `db-reset` deletes `apps/web/.wrangler` relative
// to it, and `PATH` holds the stand-in alone so the real pnpm — and through it
// wrangler — is unreachable, `--remote` included.
const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, ["--import", TSX_LOADER, join(SCRIPTS, script), ...args], {
    cwd: sandbox,
    env: { PATH: sandbox },
    input: `${TYPED}\n`,
    encoding: "utf8",
    timeout: 30_000,
  });

describe("db:* scripts and the caller's stdin", () => {
  it.each([["db-reset.ts"], ["db-migrate.ts"], ["db-seed.ts"]])(
    "%s gives a local wrangler nothing to wait on, and passes its output through",
    (script) => {
      const result = run(script);

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/argv=\[.*wrangler d1 .*--local/);
      expect(result.stdout).toContain("stdin=[]");
      expect(result.stderr).toContain("on-stderr");
    },
    30_000,
  );

  // The remote path is deliberately untouched: a confirmation before migrating
  // production is the one place the prompt earns its keep.
  it("db-migrate.ts --remote still hands wrangler the caller's stdin", () => {
    const result = run("db-migrate.ts", "--remote");

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/argv=\[.*wrangler d1 .*--remote/);
    expect(result.stdout).toContain(`stdin=[${TYPED}]`);
  }, 30_000);
});
