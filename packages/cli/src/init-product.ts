/**
 * Stamp product identity onto a fresh clone of the starter.
 * Usage: pnpm init:product <product-name> [display name]
 *   e.g. pnpm init:product acme            -> slug "acme",  display "Acme"
 *        pnpm init:product acme "Acme Cloud"                display "Acme Cloud"
 * See docs/starter-as-upstream.md for the full workflow.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  deriveDisplayName,
  isValidProductSlug,
  stampProductIdentity,
  stampWranglerConfig,
} from "./lib/init-product";

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

rewrite("package.json", (c) =>
  c.replace(/"name": "cloudflare-starter"/, () => `"name": "${name}"`),
);

rewrite("packages/config/src/product.ts", (c) =>
  stampProductIdentity(c, { slug: name, displayName }),
);

rewrite("apps/web/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { from: "starter-web", to: `${name}-web` }),
);

rewrite("apps/mcp/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { from: "starter-mcp", to: `${name}-mcp` }),
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
  2. Set production secrets (docs/README.md#production-secrets):
       BETTER_AUTH_SECRET, BETTER_AUTH_URL, optional OAuth credentials
  3. Create apps/web/.dev.vars for local dev.
  4. Product packages go under your own scope (docs/creating-packages.md).
  5. Own your design workflow: create your product's V0 project and shadcn
     theme preset, then replace the URLs in docs/design-workflow.md.
  6. Starter updates: git fetch upstream && git merge upstream/main
     (docs/starter-as-upstream.md)
`);
