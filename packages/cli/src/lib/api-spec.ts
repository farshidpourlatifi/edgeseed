/**
 * Pure logic for `pnpm api:spec`: which mode the arguments select, and how the
 * rendered spec compares with the committed one.
 */

export type SpecArgs = { ok: true; check: boolean } | { ok: false; error: string };

/**
 * No argument writes the spec; `--check` compares without writing.
 *
 * Anything else is refused rather than ignored. An ignored typo (`--chekc`)
 * would select write mode, and the command would then rewrite the file it was
 * asked to check and report success.
 */
export function parseSpecArgs(argv: string[]): SpecArgs {
  const unknown = argv.find((arg) => arg !== "--check");
  if (unknown !== undefined) return { ok: false, error: `Unknown argument: ${unknown}` };
  if (argv.length > 1) return { ok: false, error: "--check was given twice" };
  return { ok: true, check: argv.length === 1 };
}

/**
 * The committed spec against the one the API renders now. Strict equality: the
 * file is generated, so any difference, a trailing newline included, means it
 * was not produced by this command from this code.
 */
export function specState(
  rendered: string,
  committed: string | null,
): "current" | "stale" | "missing" {
  if (committed === null) return "missing";
  return rendered === committed ? "current" : "stale";
}
