/**
 * Which database a `wrangler d1` command acts on.
 *
 * Pure and tested because getting it wrong is silent and expensive: wrangler
 * defaults to **local** when neither flag is passed, so an empty string here
 * does not mean "remote" — it means "quietly do nothing to production while
 * reporting success". That was a live bug.
 *
 * Always pass the flag explicitly. Never rely on wrangler's default.
 */

export interface DbTarget {
  remote: boolean;
  /** The wrangler flag to pass. Never empty. */
  flag: "--remote" | "--local";
  /** For log output. */
  label: "remote" | "local";
}

export function resolveDbTarget(argv: readonly string[]): DbTarget {
  const remote = argv.includes("--remote");
  return {
    remote,
    flag: remote ? "--remote" : "--local",
    label: remote ? "remote" : "local",
  };
}
