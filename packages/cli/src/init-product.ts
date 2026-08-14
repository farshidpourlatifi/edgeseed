/**
 * Stamp product identity onto a fresh clone of the starter.
 * Usage: pnpm init:product <product-name> [display name] [--repo <url>]
 *   e.g. pnpm init:product acme            -> slug "acme",  display "Acme"
 *        pnpm init:product acme "Acme Cloud"                display "Acme Cloud"
 *        pnpm init:product acme --repo https://github.com/acme/acme
 * See docs/starter-as-upstream.md for the full workflow.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  currentProductRepo,
  currentProductSlug,
  INIT_USAGE,
  parseInitArgs,
  stampProductIdentity,
  stampProductRepo,
  stampWranglerConfig,
} from "./lib/init-product";

const PRODUCT_FILE = "packages/config/src/product.ts";

const parsed = parseInitArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  console.error(INIT_USAGE);
  process.exit(1);
}

const { slug: name, displayName, repoUrl } = parsed.args;

function rewrite(path: string, edit: (content: string) => string) {
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  if (before !== after) {
    writeFileSync(path, after);
    console.log(`  updated ${path}`);
  }
}

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

rewrite(PRODUCT_FILE, (c) =>
  stampProductRepo(stampProductIdentity(c, { slug: name, displayName }), repoUrl),
);

// Read the file back and prove the stamps landed. Every rewrite here is a
// regex against source, and a reformatted declaration makes one match nothing
// — `rewrite` then writes nothing and says nothing, because "no change" is also
// what an already-stamped file looks like. Silence is survivable for a Worker
// name (wrangler shows it on the first deploy) but not for the repo URL: the
// clone would keep the starter's, and the first person to notice is a visitor
// following a "View on GitHub" link to somebody else's project (issue #32).
const stamped = readFileSync(PRODUCT_FILE, "utf8");
const stampedSlug = currentProductSlug(stamped);
const stampedRepo = currentProductRepo(stamped);

if (stampedSlug !== name || stampedRepo !== repoUrl) {
  console.error(`
Stamping ${PRODUCT_FILE} did not take effect:
  PRODUCT_SLUG      expected ${JSON.stringify(name)}, found ${JSON.stringify(stampedSlug)}
  PRODUCT_REPO_URL  expected ${JSON.stringify(repoUrl)}, found ${JSON.stringify(stampedRepo)}

Both are rewritten by regex against the declarations as written. Restore them to
the one-line \`export const NAME = "value";\` form and re-run — do not leave this
half-stamped, or the clone keeps the starter's identity.`);
  process.exit(1);
}

rewrite("apps/web/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { fromSlug, toSlug: name, worker: "web" }),
);

rewrite("apps/mcp/wrangler.jsonc", (c) =>
  stampWranglerConfig(c, { fromSlug, toSlug: name, worker: "mcp" }),
);

console.log(`
Done. Next steps:
  1. Create the product D1 database:
       cd apps/web && npx wrangler d1 create ${name}-db

     Then put the returned id in database_id in BOTH wrangler files:
       apps/web/wrangler.jsonc
       apps/mcp/wrangler.jsonc

     database_name is already stamped to ${name}-db in both. Nothing else
     addresses the database by name — the db:* scripts and the e2e helpers use
     the DB *binding* — so local development keeps working before you ever
     create a remote database.

     Both ids must match. apps/mcp runs its own Better Auth instance against
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
${
  repoUrl
    ? `  8. The landing page links to ${repoUrl} — its header, footer, hero button
     and clone command all read PRODUCT_REPO_URL.`
    : `  8. No repository URL was set, so the landing page renders without its
     GitHub link and without a "git clone" command. That is the safe default,
     not a broken state. Once your repo exists, set PRODUCT_REPO_URL in
     packages/config/src/product.ts (or re-run with --repo) and the header,
     footer, hero button and clone command come back pointing at it.`
}

The landing page under apps/web/app/components/landing/ is starter marketing.
Every reference to the starter's own identity is now derived — but the copy is
still about the starter, so replace it with your product's when you have one.

Only if you deploy this alongside another product in the SAME Cloudflare
account: change the namespace_id values under "ratelimits" in both wrangler
files. They are account-scoped names for the auth rate-limit counters, so two
products left on the starter's ids would share buckets and throttle each other.
Nothing to provision — any integer you have not used will do.
`);
