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
 * Rewrite a `wrangler.jsonc`: rename the Worker and drop the database binding
 * back to `local`.
 *
 * Both Workers must land on the SAME database — apps/mcp runs its own Better
 * Auth instance against apps/web's users. Localising only one would leave a
 * clone with its other Worker still bound to the *starter's* D1 id: not merely
 * a broken shared login, but a cross-product data boundary.
 */
export function stampWranglerConfig(source: string, rename: { from: string; to: string }): string {
  return source
    .replace(new RegExp(`"name": "${rename.from}"`), () => `"name": "${rename.to}"`)
    .replace(/"database_id": "[^"]*"/, () => '"database_id": "local"');
}
