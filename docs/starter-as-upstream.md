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
database, put its `database_id` in **both** `apps/web/wrangler.jsonc` **and**
`apps/mcp/wrangler.jsonc`, set production secrets (see
`docs/README.md#production-secrets`), and set up OAuth apps.

`database_name` needs no edit — `init:product` stamps it to `<slug>-db` in both
files. It is safe to stamp only because nothing addresses the database by name:
the `db:*` scripts and the e2e helpers use the `DB` **binding**
(`packages/cli/src/lib/d1-binding.ts`). Renaming the database while a script
still named it is what used to break a fresh clone, and `d1 migrations apply`
misreported it as "No migrations present" — so if you ever reintroduce a name
literal, undo the stamping with it.

Both Wrangler files must name the same database. `apps/mcp` runs its own Better
Auth instance against `apps/web`'s users, so a different id there is a different
set of users — the MCP consent screen would not find the account you signed up
with. `init:product` resets both ids to `"local"`; only production needs the
real id.

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

### Adopting the release that untracked the route types — one manual step

`apps/web/.react-router/types/` used to be generated **and** tracked, which made
every route-adding upstream release conflict with every route-adding product —
`app/routes.ts` merges line-by-line, but the generated union is a single list.
Issue #30 gitignored the directory upstream, which ends that conflict for good.
The merge that _carries_ that change is the exception, because a `.gitignore`
has no effect on paths already in the product's index.

Two things happen on that one merge, and only the first announces itself:

- Upstream **deletes** the twelve files it tracked. A product that added a route
  has **modified** `+routes.ts`, since every route lands in that one union — so
  git reports `CONFLICT (modify/delete)` instead of taking the deletion.
- The per-route files for the product's **own** routes were never upstream's, so
  the merge leaves them alone. They stay tracked and keep conflicting on every
  later route-adding merge — the exact problem this was meant to end. Nothing
  reports this one; it is silent.

Taking the deletion across the whole directory settles both:

```bash
git merge upstream/main            # CONFLICT (modify/delete) under .react-router/
git rm -r --cached apps/web/.react-router
git commit                         # completes the merge
pnpm install && pnpm verify        # typecheck regenerates the directory
```

`--cached` is the load-bearing flag: the files leave the index but stay on disk,
gitignored from then on. Nothing needs regenerating by hand — `pnpm verify` runs
`pnpm typecheck`, which runs `react-router typegen` first. After this one merge,
an upstream release that adds a route and a product that adds its own merge
cleanly.

## Proving the clone path — the manual release exercise

Most of the adoption path is covered automatically: `init-product.test.ts`
asserts the stamping rules and fails if any `db:*` script or e2e helper goes
back to addressing D1 by name, and `pnpm verify` covers everything a clone runs
locally. What follows is the part no test in this repo can reach, because it
needs credentials, a Cloudflare account, or a real OAuth client. Walk it before
a release that changes cloning, identity stamping, or the first-run path.

1. Clone the **public** repo into a throwaway directory — not a copy of a
   working tree, which hides anything uncommitted or gitignored.
2. `pnpm install && pnpm init:product acme "Acme Cloud"`, then confirm the four
   files stamping owns carry no upstream identity — both `wrangler.jsonc`
   files, `packages/config/src/product.ts`, and the root `package.json`:

   ```bash
   grep -ri edgeseed apps/*/wrangler.jsonc packages/config/src/product.ts package.json
   ```

   Scope it to those four. A whole-tree `grep -ri edgeseed apps packages` also
   matches this repo's own tests, `.dev.vars.example` comments and the CLI's
   rename fixtures — all correct in a clone — so a wider check fails on a
   healthy repo and teaches the reader to skip it.

3. Replace the identity `init:product` does **not** own, because it is content
   rather than configuration:
   - `apps/web/app/components/landing/site.ts` — `GITHUB_URL`, which otherwise
     points a clone's landing page and footer at the starter's repository
   - `apps/web/app/components/landing/quality.tsx` — the terminal demo prints
     `~/edgeseed` and `edgeseed@… verify` as its working directory and script
     output

   Both are product-owned surface under the ownership table above, so they are
   yours to rewrite; the exercise exists partly to catch them before a clone
   ships someone else's repository link.

4. `cp apps/web/.dev.vars.example apps/web/.dev.vars`, generate a secret with
   `openssl rand -hex 32`, and leave every optional key empty. The clone must
   boot on that alone.
5. `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm check:boot`.
6. Drive register → verification gate → login → dashboard in a browser.
7. **Real email**: set `RESEND_API_KEY` + `EMAIL_FROM` and confirm a
   verification message actually arrives. Unset, the sender only logs, and a
   _configured but failing_ sender is quiet too (AGENTS.md concern #1).
8. **Social login**: register callbacks for the clone's own origin and sign in
   with GitHub and Google. Each origin needs its own registration.
9. **Remote D1**: create a database, put its id in both wrangler files, and
   apply migrations with `pnpm db:migrate --remote`.
10. **MCP**: point a real client at `/mcp` and complete the OAuth flow through
    to a `tools/call`.
11. Merge a later upstream release in and re-run `pnpm verify`.

Steps 7–10 are why this stays a manual exercise: each one fails _quietly_ in a
way local tests cannot see — a swallowed mail rejection, a missing provider
callback, a pragma D1 rejects but miniflare accepts, a grant that never mints.
