/**
 * Pure text transforms for `pnpm init:product`.
 *
 * Separated from the script so the rewriting rules are testable without
 * touching the filesystem — these edit source files by regex, so a bad
 * replacement silently produces a repo that no longer compiles.
 */

export const PRODUCT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isValidProductSlug(value: string): boolean {
  return PRODUCT_SLUG_PATTERN.test(value);
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
