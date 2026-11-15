import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";

/**
 * `.gitattributes` is configuration for git, so the only honest test of it is
 * git: these run real merges in a throwaway repository holding this repo's
 * attributes file.
 *
 * Every call runs in the temp directory with an environment built from
 * scratch — no inherited `GIT_*` variable, no user or system config — so the
 * test cannot touch the checkout it runs from. Assertions are on exit codes and
 * file contents, never on git's message text.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const LOCKFILE = "pnpm-lock.yaml";

const BASE = ["lockfileVersion: '9.0'", "", "top: 1", "", "middle: 1", "", "bottom: 1", ""].join(
  "\n",
);
const OURS = BASE.replace("top: 1", "top: 2");
const THEIRS = BASE.replace("bottom: 1", "bottom: 2");

describe("pnpm-lock.yaml merge attribute", () => {
  let dir: string;

  const git = (...args: string[]) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });

  const run = (...args: string[]) => {
    const result = git(...args);
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  };

  const commitLockfile = (content: string, message: string) => {
    writeFileSync(join(dir, LOCKFILE), content);
    run("add", "-A");
    run("commit", "-q", "-m", message);
  };

  const lockfile = () => readFileSync(join(dir, LOCKFILE), "utf8");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lockfile-merge-"));
    run("init", "-q", "-b", "main");
    copyFileSync(join(REPO_ROOT, ".gitattributes"), join(dir, ".gitattributes"));
    commitLockfile(BASE, "base");
    run("checkout", "-q", "-b", "other");
    commitLockfile(THEIRS, "other changes the lockfile");
    run("checkout", "-q", "main");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The two edits are far enough apart that a line merge succeeds, which is
   * the case that matters: a lockfile stitched from two resolutions that no
   * install ever produced.
   */
  it("should conflict and keep the current branch's copy when both sides changed it", () => {
    commitLockfile(OURS, "main changes the lockfile");

    const merge = git("merge", "--no-edit", "other");

    expect(merge.status).not.toBe(0);
    expect(run("ls-files", "-u", "--", LOCKFILE)).not.toBe("");
    expect(lockfile()).toBe(OURS);
  });

  it("should merge cleanly when only the other side changed it", () => {
    writeFileSync(join(dir, "unrelated.txt"), "x\n");
    run("add", "-A");
    run("commit", "-q", "-m", "main changes something else");

    const merge = git("merge", "--no-edit", "other");

    expect(merge.status).toBe(0);
    expect(run("ls-files", "-u", "--", LOCKFILE)).toBe("");
    expect(lockfile()).toBe(THEIRS);
  });
});
