/**
 * Pure text transforms for `pnpm init:product`.
 *
 * Separated from the script so the rewriting rules are testable without
 * touching the filesystem — these edit source files by regex, so a bad
 * replacement silently produces a repo that no longer compiles.
 */
import { canonicalRepoUrl } from "@starter/config/repo-url";

export const PRODUCT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isValidProductSlug(value: string): boolean {
  return PRODUCT_SLUG_PATTERN.test(value);
}

export const INIT_USAGE =
  "Usage: pnpm init:product <product-name> [display name] [--repo <url>]\n" +
  "  e.g. pnpm init:product acme\n" +
  '       pnpm init:product acme "Acme Cloud" --repo https://github.com/acme/acme-cloud\n' +
  "  --repo is optional and defaults to empty, which hides the landing page's\n" +
  "  GitHub links. Set it later in packages/config/src/product.ts.";

export type InitArgs = { slug: string; displayName: string; repoUrl: string };
export type ParsedInitArgs = { ok: true; args: InitArgs } | { ok: false; error: string };

/**
 * A rendition of a rejected argument that is safe to print back at the user.
 *
 * Every rejection quotes the offending value, because a bare "invalid URL" sends
 * someone hunting through their shell history. But the entrypoint prints these
 * to stderr, and stderr in CI is a log that outlives the run — so quoting the
 * value verbatim means a `--repo https://user:token@host/r` puts the token in
 * that log. Refusing the URL keeps it off the landing page and does nothing
 * about the transcript, which is the same distinction AGENTS.md draws about
 * secrets: once it is in a transcript it has left the machine.
 *
 * Three transforms, in this order:
 *
 * 1. **Userinfo becomes `***`.** Through the authority's *last* `@`, because
 *    that is the one a URL parser splits on: `https://user:tok@en@github.com/a`
 *    has the password `tok@en`, so stopping at the first `@` would print
 *    `https://***@en@github.com/a` and leak its tail. `[^/?#]*` is greedy and
 *    cannot cross into the path, so it settles on the authority's last `@` and
 *    leaves an `@` in a path or query alone. Scheme and `//` are both optional,
 *    so a value typed without either — `ghp_token@github.com/a` — is redacted
 *    too. Runs before truncation, so a long credential cannot be preserved by
 *    being cut off mid-token.
 * 2. **C0/C1 controls become U+FFFD.** An argument is arbitrary bytes, and ANSI
 *    escapes echoed to a terminal can rewrite what the reader sees — including
 *    hiding the rest of the message. A visible replacement character says
 *    something was there rather than silently dropping it.
 * 3. **Truncate.** A pasted-wrong argument can be a whole file.
 */
/** Stands in for a value whose shape cannot be shown to be credential-free. */
export const UNVERIFIABLE_VALUE = "<redacted: may contain a credential>";

/**
 * Whether an `@` left in `value` is provably harmless.
 *
 * True only when the value parses *and* carries no userinfo, which puts the
 * `@` in a path, query or fragment. A value that does not parse cannot be
 * reasoned about at all — and "does not parse" is the normal state here, since
 * this only ever runs on input that was already rejected.
 */
function parsesWithoutUserinfo(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return !parsed.username && !parsed.password;
  } catch {
    // Stryker reports `catch {}` as a surviving mutant here and it is a genuine
    // equivalent: the only caller negates the result, where `undefined` and
    // `false` are the same answer. Not worth contorting the code to kill.
    return false;
  }
}

export function redactForMessage(value: string): string {
  const withoutCredentials = value.replace(
    /^((?:[a-zA-Z][a-zA-Z0-9+.-]*:)?(?:\/\/)?)[^/?#]*@/,
    (_match, prefix: string) => `${prefix}***@`,
  );

  // Structured redaction did not fire, yet an `@` survives. Credentials that
  // are *malformed* land here: `https://user:tok/en@github.com/a` has an
  // unencoded `/` in the password, so the authority ends before the `@` and the
  // pattern never matches — while the URL does not parse either, so nothing
  // else establishes that `tok` is not a secret. Base64-shaped tokens contain
  // `/`, which makes this a paste away rather than a curiosity. Refuse to echo
  // it: a less helpful message costs less than a token in a CI log.
  if (withoutCredentials === value && value.includes("@") && !parsesWithoutUserinfo(value)) {
    return UNVERIFIABLE_VALUE;
  }
  // Matching control characters is the entire purpose here: they are exactly
  // what must not reach a terminal.
  // eslint-disable-next-line no-control-regex
  const printable = withoutCredentials.replace(/[\u0000-\u001F\u007F-\u009F]/g, "\uFFFD");

  return printable.length > 120 ? `${printable.slice(0, 120)}…` : printable;
}

/**
 * Parse `process.argv.slice(2)` into the identity to stamp.
 *
 * Flags are pulled out before positionals are read, which is the whole reason
 * this is a function rather than three `argv[n]` reads: with `--repo` appended
 * after the slug, a naive `argv[1]` takes the literal string `"--repo"` as the
 * product's **display name** and stamps it into `PRODUCT_NAME`. Unknown flags
 * and surplus positionals are refused for the same class of reason — an
 * unquoted `pnpm init:product acme Acme Cloud` would otherwise stamp "Acme" and
 * silently drop "Cloud".
 */
export function parseInitArgs(argv: string[]): ParsedInitArgs {
  const positionals: string[] = [];
  let repoUrl = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const value = arg.startsWith("--repo=") ? arg.slice("--repo=".length) : argv[++i];
      if (value === undefined) return { ok: false, error: "--repo needs a URL." };

      // The canonical form is what gets stamped, never `value`. A URL that
      // merely *parses* is not one that can be written to a source file and
      // read back: a trailing newline survives `new URL`, becomes `\n` under
      // JSON.stringify, and reads back as two characters — so the script's own
      // stamp check fails, after it has already rewritten package.json.
      const canonical = canonicalRepoUrl(value);
      if (canonical === null) {
        return { ok: false, error: `Not a usable repository URL: ${redactForMessage(value)}` };
      }
      repoUrl = canonical;
      continue;
    }

    if (arg.startsWith("-"))
      return { ok: false, error: `Unknown option: ${redactForMessage(arg)}` };
    positionals.push(arg);
  }

  const [slug, displayName, ...surplus] = positionals;
  if (!slug) return { ok: false, error: "A product name is required." };
  if (!isValidProductSlug(slug)) {
    return { ok: false, error: `Not a kebab-case product name: ${redactForMessage(slug)}` };
  }
  if (surplus.length > 0) {
    return {
      ok: false,
      error: `Unexpected argument: ${redactForMessage(surplus[0])} — quote a display name containing spaces.`,
    };
  }

  return { ok: true, args: { slug, displayName: displayName ?? deriveDisplayName(slug), repoUrl } };
}

/** "my-product" -> "My Product". */
export function deriveDisplayName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The slug currently stamped in `product.ts` — the identity being renamed
 * *from*.
 *
 * Read rather than hardcoded so the script cannot drift from the repo it
 * edits. When the starter itself was renamed (`starter` → `edgeseed`), a
 * hardcoded `"starter-web"` here would have turned every Worker rename into a
 * silent no-op: the regex simply stops matching, `rewrite()` sees no change,
 * and the clone keeps the upstream's Worker names.
 */
export function currentProductSlug(productSource: string): string | null {
  return productSource.match(/export const PRODUCT_SLUG = "([^"]*)"/)?.[1] ?? null;
}

/**
 * Rewrite `packages/config/src/product.ts`.
 *
 * Replacements are functions, not strings: `String.replace` treats `$&`, `$1`
 * and `` $` `` as special sequences in a replacement *string*, and the display
 * name is arbitrary user input. `JSON.stringify` then produces a valid TS
 * literal even for a name containing a quote, backslash or newline.
 */
export function stampProductIdentity(
  source: string,
  identity: { slug: string; displayName: string },
): string {
  return source
    .replace(
      /export const PRODUCT_NAME = "[^"]*"/,
      () => `export const PRODUCT_NAME = ${JSON.stringify(identity.displayName)}`,
    )
    .replace(
      /export const PRODUCT_SLUG = "[^"]*"/,
      () => `export const PRODUCT_SLUG = ${JSON.stringify(identity.slug)}`,
    );
}

/**
 * The repo URL currently stamped in `product.ts`.
 *
 * Read for the same reason as `currentProductSlug`, plus one of its own: the
 * script verifies its own stamp through this, so a reformatted declaration
 * fails loudly instead of leaving the clone pointed at the starter — the exact
 * outcome issue #32 exists to prevent.
 */
export function currentProductRepo(productSource: string): string | null {
  return productSource.match(/export const PRODUCT_REPO_URL = "([^"]*)"/)?.[1] ?? null;
}

/**
 * Whether a value may be stamped as the product's repository URL.
 *
 * Thin wrapper over the shared rule, kept as a named predicate because callers
 * read better for it. What gets *stamped* is always `canonicalRepoUrl`'s return
 * value, never the caller's string — see `parseInitArgs`.
 */
export function isValidRepoUrl(value: string): boolean {
  return canonicalRepoUrl(value) !== null;
}

/**
 * Rewrite `PRODUCT_REPO_URL` in `packages/config/src/product.ts`.
 *
 * The default is `""`, not the starter's URL and not a guess from the slug:
 * nothing derives a repository from a product name, and `init:product` usually
 * runs before the remote exists. Empty makes the landing page hide its GitHub
 * affordances, so the failure mode of never setting it is a page with one fewer
 * button — never a page advertising somebody else's repository (issue #32).
 *
 * A function replacement for the `$&`/`$1` reason `stampProductIdentity`
 * documents; the value is user input from `--repo`.
 */
export function stampProductRepo(source: string, repoUrl: string): string {
  return source.replace(
    /export const PRODUCT_REPO_URL = "[^"]*"/,
    () => `export const PRODUCT_REPO_URL = ${JSON.stringify(repoUrl)}`,
  );
}

/**
 * Rewrite a `wrangler.jsonc`: rename the Worker, localise the database name and
 * id, and remove any custom domain.
 *
 * Both Workers must land on the SAME database — apps/mcp runs its own Better
 * Auth instance against apps/web's users. Localising only one would leave a
 * clone with its other Worker still bound to the *starter's* D1 id: not merely
 * a broken shared login, but a cross-product data boundary.
 *
 * `database_name` is stamped here rather than left as a printed instruction.
 * It used to be manual, and following that instruction *broke the clone*: the
 * `db:*` scripts addressed D1 by name, so renaming it to `<slug>-db` made
 * `db:migrate`, `db:seed`, `db:reset` and the e2e helpers resolve nothing.
 * They now address the `DB` binding instead (`lib/d1-binding.ts`), which is
 * what makes stamping the name safe — fix both halves or neither.
 *
 * `routes` goes for the same reason in a different currency: it names the
 * starter's own hostname, and a clone that inherited it would have its first
 * deploy try to claim a zone somebody else owns.
 */
export function stampWranglerConfig(
  source: string,
  rename: { fromSlug: string; toSlug: string; worker: string },
): string {
  const { fromSlug, toSlug, worker } = rename;

  return source
    .replace(new RegExp(`"name": "${fromSlug}-${worker}"`), () => `"name": "${toSlug}-${worker}"`)
    .replace(
      new RegExp(`"database_name": "${fromSlug}-db"`),
      () => `"database_name": "${toSlug}-db"`,
    )
    .replace(/"database_id": "[^"]*"/, () => '"database_id": "local"')
    .replace(ROUTES_BLOCK, "");
}

/**
 * A `routes` array plus the comment block above it and its trailing comma.
 *
 * Deliberately not a brace-matching parse: the value is always a flat array of
 * route objects, so `[^\]]*` terminates correctly. A nested array here would
 * need a real parser — assert on the shape if that ever changes.
 */
const ROUTES_BLOCK = /\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*"routes": \[[^\]]*\],?/;
