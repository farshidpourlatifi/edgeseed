/**
 * Product identity — stamped by `pnpm init:product <name>`.
 *
 * Anything user-visible that names the product reads from here rather than
 * hardcoding a string, so a downstream repo renames itself in one place. See
 * docs/starter-as-upstream.md.
 */

/** Human-readable name, shown to users and to MCP clients. */
export const PRODUCT_NAME = "Starter";

/** Kebab-case identifier, matching the Worker names in wrangler.jsonc. */
export const PRODUCT_SLUG = "starter";

/**
 * What an MCP client displays for this server in its own UI.
 * Kept derived so renaming the product renames the MCP server with it.
 */
export const MCP_SERVER_NAME = `${PRODUCT_NAME} MCP`;
