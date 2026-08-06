# Using This Starter as an Upstream

How to spin a product repo off this starter and keep receiving starter
improvements. The model: **two ownership layers in one repo**.

| Layer     | Scope                                                                    | Owner                | Downstream policy                                       |
| --------- | ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------- |
| Framework | `@starter/*` packages, tooling, CI, docs                                 | this repo (upstream) | read-only — never edit in a product repo                |
| Product   | your scope (e.g. `@acme/*`), `apps/*` content, `docs/design-workflow.md` | the product repo     | owned downstream; upstream never ships product packages |

Because product packages live in directories upstream never creates, and
`@starter/*` is never edited downstream, `git merge upstream/main` stays clean.

## Creating a product repo

```bash
git clone <starter-remote-url> acme && cd acme
git remote rename origin upstream
git remote add origin <new-product-repo-url>
pnpm install
pnpm init:product acme        # stamps worker names + root package name
git push -u origin main
```

Then follow the init script's printed next steps: create the product's D1
database, put its `database_id` and `database_name` in **both**
`apps/web/wrangler.jsonc` **and** `apps/mcp/wrangler.jsonc`, set production
secrets (see `docs/README.md#production-secrets`), and set up OAuth apps.

Both Wrangler files must name the same database. `apps/mcp` runs its own Better
Auth instance against `apps/web`'s users, so a different id there is a different
set of users — the MCP consent screen would not find the account you signed up
with. `init:product` resets both to `"local"`; only production needs the real id.

## Rules that keep merges clean

1. **Never edit `@starter/*` packages in a product repo.** Found a bug or
   improvement? Fix it in a starter checkout, commit there, then
   `git merge upstream/main` into products.
2. **Product code goes in product-scope packages** — create them with
   `docs/creating-packages.md`, named `@acme/*`. The starter intentionally
   ships zero product-scope packages, so this namespace is all yours.
3. **`apps/*` is the shared-ownership zone.** Downstream owns route content
   and UI; upstream keeps its post-v1 changes to apps structural and minimal.
   Occasional conflicts here are expected — resolve favoring the product,
   then re-apply the structural intent of the upstream change.
4. Keep product identity out of framework files — worker names, D1 ids, and
   titles are stamped once by `init:product`, secrets live outside git.

## Pulling starter updates

```bash
git fetch upstream
git merge upstream/main
pnpm install          # lockfile may have changed
pnpm verify           # full gate before pushing the merge
```

Do this on a branch if the diff is big. Never rebase the product's main onto
upstream — merge, so product history stays intact.
