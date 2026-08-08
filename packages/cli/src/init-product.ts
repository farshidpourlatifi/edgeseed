/**
 * Stamp product identity onto a fresh clone of the starter.
 * Usage: pnpm init:product <product-name> [display name]
 *   e.g. pnpm init:product acme            -> slug "acme",  display "Acme"
 *        pnpm init:product acme "Acme Cloud"                display "Acme Cloud"
 * See docs/starter-as-upstream.md for the full workflow.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  currentProductSlug,
  deriveDisplayName,
  isValidProductSlug,
  stampProductIdentity,
  stampWranglerConfig,
} from "./lib/init-product";

const PRODUCT_FILE = "packages/config/src/product.ts";

const name = process.argv[2];
if (!name || !isValidProductSlug(name)) {
  console.error(
    'Usage: pnpm init:product <product-name> [display name]  (kebab-case, e.g. acme "Acme Cloud")',
  );
  process.exit(1);
}

function rewrite(path: string, edit: (content: string) => string) {
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  if (before !== after) {
    writeFileSync(path, after);
    console.log(`  updated ${path}`);
  }
}

/** Overridable with a second argument, else derived from the slug. */
const displayName = process.argv[3] ?? deriveDisplayName(name);

console.log(`Stamping product identity: ${name} ("${displayName}")`);

// Every name this script rewrites derives from the slug currently stamped in
// product.ts — never a literal. Hardcoding them means the starter cannot be
// renamed without silently breaking this script for every future clone.
// Read before stamping, or the "from" is already the "to".
const fromSlug = currentProductSlug(readFileSync(PRODUCT_FILE, "utf8"));
if (!fromSlug) {
  console.error(`Could not read PRODUCT_SLUG from ${PRODUCT_FILE} — is the declaration intact?`);
  process.exit(1);
}

rewrite("package.json", (c) =>
  c.replace(new RegExp(`"name": "${fromSlug}"`), () => `"name": "${name}"`),
);

rewrite(PRODUCT_FILE, (c) => stampProductIdentity(c, { slug: name, displayName }));

rewrite("apps/web/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { from: `${fromSlug}-web`, to: `${name}-web` }),
);

rewrite("apps/mcp/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { from: `${fromSlug}-mcp`, to: `${name}-mcp` }),
);

console.log(`
Done. Next steps:
  1. Create the product D1 database:
       cd apps/web && npx wrangler d1 create ${name}-db

     Then put the returned id in database_id in BOTH wrangler files, and set
     database_name to ${name}-db in both:
       apps/web/wrangler.jsonc
       apps/mcp/wrangler.jsonc

     Both must match. apps/mcp runs its own Better Auth instance against
     apps/web's users, so a different id there is a different set of users —
     sign-in on the MCP consent screen would silently fail to find the account.
     They are stamped to "local" for you; only production needs the real id.

     Answer "DB" if wrangler offers to add the binding. Its suggested name
     (derived from the database) appends a SECOND entry instead of replacing
     the existing one, and the app keeps reading the old c.env.DB.
  2. Add your own custom domain to apps/web/wrangler.jsonc — the starter's was
     stripped, since it named a zone you do not own:
       "routes": [{ "pattern": "yourdomain.com", "custom_domain": true }]

     The zone must be on the same Cloudflare account; wrangler then creates the
     DNS record on deploy. Skip this and you get <worker>.<subdomain>.workers.dev.

     That single entry is the default topology: one origin serving the landing
     page and the app together. To split them — marketing on the apex, app on
     app.yourdomain.com — add a second pattern and set MARKETING_URL. Full
     walkthrough, including the OAuth consequences: docs/domains.md
  3. Set production secrets (docs/README.md#production-secrets):
       BETTER_AUTH_SECRET, BETTER_AUTH_URL (must match the domain above),
       RESEND_API_KEY + EMAIL_FROM, optional OAuth credentials
  4. Create apps/web/.dev.vars for local dev.
  5. Product packages go under your own scope (docs/creating-packages.md).
  6. Own your design workflow: create your product's V0 project and shadcn
     theme preset, then replace the URLs in docs/design-workflow.md.
  7. Starter updates: git fetch upstream && git merge upstream/main
     (docs/starter-as-upstream.md)
`);
