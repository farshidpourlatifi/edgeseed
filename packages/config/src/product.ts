/**
 * Product identity — stamped by `pnpm init:product <name>`.
 *
 * Anything user-visible that names the product reads from here rather than
 * hardcoding a string, so a downstream repo renames itself in one place. See
 * docs/starter-as-upstream.md.
 */

/** Human-readable name, shown to users and to MCP clients. */
export const PRODUCT_NAME = "EdgeSeed";

/** Kebab-case identifier, matching the Worker names in wrangler.jsonc. */
export const PRODUCT_SLUG = "edgeseed";

/**
 * What an MCP client displays for this server in its own UI.
 * Kept derived so renaming the product renames the MCP server with it.
 */
export const MCP_SERVER_NAME = `${PRODUCT_NAME} MCP`;

/**
 * Public source repository, or `""` when the product has none to link.
 *
 * Not derivable from the slug — `init:product acme` cannot know where the
 * product's repo will live, and usually runs before the remote exists at all.
 * So this is stamped separately (`--repo`) and **cleared by default**: the
 * landing page hides every GitHub affordance while it is empty, which means a
 * clone that never gets around to setting it links to nothing rather than
 * pointing its own visitors at the starter's repository (issue #32).
 *
 * Never read directly. Both the landing page and `init:product` go through
 * `canonicalRepoUrl` (`./repo-url.ts`), which is what keeps "what may be
 * stamped" and "what may be rendered" the same answer.
 */
export const PRODUCT_REPO_URL = "https://github.com/farshidpourlatifi/edgeseed";

/**
 * The landing page's walkthrough film under `public/`, or `""` when the product
 * ships none.
 *
 * The film is EdgeSeed-branded **pixels** — it shows this repo's `git clone`
 * command, edgeseed.dev and EdgeSeed's own Cloudflare dashboard — and nothing
 * can rewrite an MP4 the way this file's other constants get rewritten. So the
 * section is gated on this value, which `init:product` **clears** exactly like
 * `PRODUCT_REPO_URL`: a clone's landing page renders no film rather than
 * republishing the starter's identity to its own visitors (issue #32), and can
 * then delete `apps/web/public/demo.*`. Point it at your own `/your-film.mp4`
 * (with a matching `/your-film-poster.webp`) to show yours.
 */
export const PRODUCT_DEMO_VIDEO = "/demo.mp4";
