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
pnpm init:product acme --repo <new-product-repo-url>
git push -u origin main
```

`init:product` stamps the Worker names, the root package name, and the product
identity in `packages/config/src/product.ts`. `--repo` is optional: it is the
one value nothing can derive — a slug says nothing about where the repository
will live, and this usually runs before the remote exists. Omit it and
`PRODUCT_REPO_URL` is stamped **empty**, which makes the landing page render
without its GitHub link and without a clone command. That default is the point:
a clone that never sets it links to nothing, rather than sending its own
visitors to the starter's repository (issue #32). Set it whenever the repo
exists — the constant is a one-line edit.

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
   then re-apply the structural intent of the upstream change. Where a seam
   exists, use it instead of editing the starter's file: see
   [Product seams](#product-seams).
4. Keep product identity out of framework files — worker names, D1 ids, titles
   and the repository URL are stamped once by `init:product`, secrets live
   outside git. Anything user-visible that names the product or points at its
   source reads from `packages/config/src/product.ts`; hardcoding it is how a
   clone ends up publishing the starter's identity (issue #32).

## Product seams

A file is **product-owned** when the starter ships it once, holding the
starter's default, and afterwards changes only the code that reads it. Product
edits and starter edits then never land in the same file, so they cannot
conflict.

| To                         | Edit                                                          | Contract                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace the dashboard home | `DASHBOARD_HOME_ROUTE` in `apps/web/app/product/dashboard.ts` | Names a route module under `app/`. Its loader calls `requireUser`; `tests/e2e/loader-guards.spec.ts` requests it without its parent and fails if it does not. |
| Add sidebar entries        | `PRODUCT_NAV` in `apps/web/app/product/dashboard-nav.ts`      | Listed after "Dashboard" and before the starter's entries. Registering the page is still a line in `apps/web/app/routes.ts`.                                  |

- **Put product route modules in `apps/web/app/product/`.**
- **Un-mount, do not delete.** Point the constant at your module and leave the
  starter's default (`apps/web/app/routes/dashboard._index.tsx`) where it is. A
  later starter edit to a file a product deleted is a `modify/delete` conflict
  on every merge that carries one. An un-mounted module is not in the route
  manifest, so it is not served and gets no generated route types.
- **The layout keeps what every home needs.** `apps/web/app/routes/dashboard.tsx`
  renders the sidebar and, for an account with no organization, the first-run
  card on `/dashboard`. A replacement home does not render either.

## Pulling starter updates

```bash
git fetch upstream
git merge upstream/main
pnpm install --frozen-lockfile   # refuses a lockfile that disagrees with a package.json
pnpm verify           # full gate before pushing the merge
```

Do this on a branch if the diff is big. Never rebase the product's main onto
upstream — merge, so product history stays intact.

### When both sides changed pnpm-lock.yaml

`.gitattributes` marks `pnpm-lock.yaml` as `-merge`, so when the product and upstream
have both changed it the merge stops with:

```
CONFLICT (content): Merge conflict in pnpm-lock.yaml
```

A lockfile is a resolution graph, and two graphs merged line by line can name versions
no install ever resolved together. Git therefore leaves the product's copy in place,
without conflict markers, and waits. Take the copy from the ref being merged and let
pnpm add what the product needs on top:

```bash
git checkout upstream/main -- pnpm-lock.yaml   # the graph upstream tested
pnpm install                                   # adds what your package.json files need
git add pnpm-lock.yaml
git commit                                     # completes the merge
pnpm verify
```

The merge that first brings `.gitattributes` in is not covered by it: git reads
attributes from the tree being merged into, which does not have the file yet, so that
one merge may still combine the lockfile by line. On that merge
`pnpm install --frozen-lockfile` is the check.

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

### Adopting the release that added the product seams

Applies to a product that customised `apps/web/app/routes/dashboard._index.tsx`
before the seams existed. That file conflicts on this merge, and resolving in
the product's favour (rule 3) leaves two things to do by hand:

- **Remove the first-run organization card from your home.** The card moved
  into the layout (`apps/web/app/routes/dashboard.tsx`), which now renders it on
  `/dashboard` for an account with no organization. A home that kept its own
  copy shows two, and a locator for "Create organization" matches both.
- **Move the home behind the seam, when convenient.** Move your module to
  `apps/web/app/product/`, name it in `DASHBOARD_HOME_ROUTE`, and take
  upstream's `dashboard._index.tsx`. The file then stops conflicting. Until
  then your home keeps working where it is: it is still mounted, so its
  `./+types/dashboard._index` import still resolves.

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

3. Confirm the landing page carries no upstream identity. It no longer needs
   editing to be _safe_ — `--repo` is the only part that is a decision:

   ```bash
   grep -rn "git clone\|github.com" apps/web/app/components/landing/
   ```

   Without `--repo`, `PRODUCT_REPO_URL` is `""` and the page renders with no
   GitHub link and no clone command at all. That is the intended state for a
   clone whose repository does not exist yet, not a broken one — set it later in
   `packages/config/src/product.ts` and the header, footer, hero button and
   clone command return, pointing at it. The terminal demo derives its working
   directory and script output from `PRODUCT_SLUG` and `APP_VERSION`, so it
   needs nothing (issue #32).

   What is still yours to replace is the **copy**: the landing page is starter
   marketing, and every word of it is about a starter kit. Nothing breaks if you
   ship it as-is, but it describes the wrong product.

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
