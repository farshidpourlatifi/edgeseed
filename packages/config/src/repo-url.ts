/**
 * The one rule for what may be published as the product's repository URL.
 *
 * Shared by `pnpm init:product`, which stamps `PRODUCT_REPO_URL`, and by the
 * landing page, which renders it. Two copies of this rule would be worse than
 * one in the wrong place: the *whole* guarantee is that what the CLI accepts is
 * exactly what the page can safely render, and a drift between them is how both
 * of the bugs below come back.
 */

/**
 * Characters provably free of shell meaning, since the value is handed to a
 * human as a `git clone` line to paste into a terminal.
 *
 * An allowlist rather than a denylist, because `new URL().href` normalisation
 * is not the protection it looks like: it percent-encodes spaces, backticks and
 * braces, but leaves `$ & ( ) ; * | ~ ! [ ]` untouched in a path.
 *
 * Absent from the set, and load-bearing for it: `?` and `#`. Excluding them is
 * also what refuses a query string or fragment — both meaningless in a clone
 * URL — so there is deliberately no separate check for those. A `search` or
 * `hash` cannot exist without the character that introduces it.
 *
 * `: / % + , @ . _ -` are all inert to `sh`, so the clone command needs no
 * quoting — `cloneCommand` in the web app is asserted to stay copy-paste-safe
 * without it.
 */
const SHELL_SAFE = /^[A-Za-z0-9._\-/:%+,@]+$/;

/**
 * Canonicalise a repository URL, or return `null` if it may not be published.
 *
 * Returns `parsed.href`, never the caller's string. Validating with `new URL()`
 * and then keeping the input is the defect this exists to prevent, and it has
 * two distinct consequences:
 *
 * - `https:example.com/a` and `https://x/y\n` both *parse*, so a check that
 *   discards the result accepts them and stores a value that renders as a
 *   broken link. The newline is worse in the CLI: `JSON.stringify` escapes it,
 *   the read-back regex then reads two characters where one was written, and
 *   the stamp verification fails **after** other files are already rewritten.
 * - Credentials survive canonicalisation untouched. `https://u:token@host/r` is
 *   already its own `href`, so nothing about normalising catches it — it has to
 *   be refused, or the landing page publishes the token in an anchor and in a
 *   command the reader is invited to copy.
 */
export function canonicalRepoUrl(value: string): string | null {
  let parsed: URL;
  try {
    // `trim()` is not redundant with what the URL parser does for itself. It
    // strips leading/trailing *C0 or space* only, so a pasted non-breaking
    // space — the usual souvenir of copying a URL out of a rendered page —
    // survives and turns the whole thing into a parse error.
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // Never publish a credential, however it arrived. Nothing else here catches
  // this: `https://u:token@host/r` is already its own canonical `href`.
  if (parsed.username || parsed.password) return null;
  if (!SHELL_SAFE.test(parsed.href)) return null;

  return parsed.href;
}
