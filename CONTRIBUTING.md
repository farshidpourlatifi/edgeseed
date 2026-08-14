# Contributing to EdgeSeed

Thanks for taking the time. This file covers the workflow; the engineering rules
themselves live in **[AGENTS.md](./AGENTS.md)**, which is canonical for this repository.
Read it before a first substantive change — it is deliberately not duplicated here,
because two copies drift and the wrong one gets trusted.

## Before you start

- **Bugs and features:** open an issue first for anything beyond a typo or an obvious
  one-line fix. It is cheaper to disagree about scope in an issue than in a review.
- **Security problems:** do not open an issue. Follow [SECURITY.md](./SECURITY.md).
- **Building your own product on this?** You probably want
  [docs/starter-as-upstream.md](./docs/starter-as-upstream.md) instead — product
  features belong in your repository, not in the starter.

## Setup

Node.js 22+ and pnpm 9+.

```bash
git clone https://github.com/farshidpourlatifi/edgeseed
cd edgeseed
pnpm install

# Required. The env is validated on every request and fails closed, so without
# this every page answers 500. Fill in BETTER_AUTH_SECRET (`openssl rand -hex 32`)
# and BETTER_AUTH_URL=http://localhost:5173
cp apps/web/.dev.vars.example apps/web/.dev.vars

pnpm db:migrate
pnpm db:seed          # signs in as admin@example.com / dev-password-123
pnpm dev --filter @starter/web
```

Do **not** run `pnpm init:product` when contributing to the starter itself — it rewrites
the product identity, which is exactly what a contribution should leave alone.

Working on `apps/mcp` too? It is a separate Worker with its own env:
`cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars`.

## The gate

One command decides whether a change is done:

```bash
pnpm verify
```

It runs lint, format, unit tests, a gitleaks scan, build, typecheck, the Worker boot
check and e2e. CI runs those across four required jobs — `quality`, `e2e`, `drift`,
`scan` — and a pull request cannot merge until all four are green.

**`verify` is not quite the whole of CI.** The `drift` job also runs `pnpm check:docs-sync`
and re-generates the OpenAPI spec to diff it, and neither is part of `verify`. If your
change touches docs, links, a root script, an API route or an MCP tool, run this too or
CI will find it for you:

```bash
pnpm check:docs-sync
```

Two traps that look like code regressions and are not:

- **Stop every dev server before `pnpm test:e2e`.** The e2e global setup runs a database
  reset; a server still holding the dropped D1 file makes every auth call fail with
  `SQLITE_CANTOPEN`, and an orphaned server bound IPv6-only produces
  `ERR_CONNECTION_REFUSED`. Check with `lsof -nP -iTCP:5173 -sTCP:LISTEN`.
- **`pnpm build` proves a Worker compiles; `pnpm check:boot` proves it runs.** Never
  report a Worker as working on the strength of a build.

## Branching and commits

- **Branch before committing** — never commit directly to `main`.
- Create the branch without inheriting `main`'s upstream:

  ```bash
  git checkout -b feat/my-change --no-track origin/main
  ```

  Branching from `origin/main` the ordinary way makes `origin/main` your branch's
  upstream, so a later bare `git push` writes straight to `main` — no warning, and every
  branch protection is simply never consulted. This has happened here. Verify with
  `git rev-parse --abbrev-ref --symbolic-full-name @{u}`: it must print your branch or
  fail with "no upstream", never `origin/main`. Push with the explicit form:

  ```bash
  git push -u origin feat/my-change
  ```

- **Conventional commits** — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`,
  with an optional scope (`fix(auth): …`).
- **Never `--no-verify`.** The pre-commit hook runs lint-staged and a gitleaks secret
  scan; skipping it is how a credential reaches the remote.
- **Never force-push a shared branch** or rewrite already-pushed history.

## What a good change looks like

The engineering principles are in AGENTS.md. In review, these are the things most often
sent back:

- **Every guard ships its deny-path test.** The allow path passing proves almost nothing.
  A new auth guard, a new default-deny route, a new validation rule — test the refusal.
- **Guard where the data is read**, not one layer up. In particular, every protected
  loader calls `requireUser` itself, including children of the dashboard layout: the
  layout loader is not a security boundary in React Router v7.
- **Test behavior at the boundary, not the implementation inside it.** A test that breaks
  on a refactor with no behavior change is working against you.
- **Coverage is a gap-finder, not a goal.** There is no repo-wide threshold on purpose —
  each package sets its own target in its `CLAUDE.md`, matched to what the code is.
- **Deduplicate knowledge, not lines.** Two call sites that merely look alike are not
  duplication until they must change together.
- **New surface is default-deny.** A new API route is authenticated unless you add it to
  `PUBLIC_OPERATIONS` on purpose, by method and path.
- **Never edit a migration that has reached production.** Add a new one.
- **Never add per-file license headers.** The root `LICENSE` covers the tree.

If your change adds surface, walk the checklist at the end of AGENTS.md § Security
standards — new route, new loader, new binding, new guard, new inline script.

## Documentation is part of the change

- **When you invalidate a claim in one file, grep for its other homes.** `README.md`,
  `docs/`, `AGENTS.md`, the per-package `CLAUDE.md` files and the review skill repeat one
  another, and a stale copy is trusted. Docs that contradict the code are worse than
  missing docs.
- `pnpm check:docs-sync` enforces the mechanical part of this and runs in CI: undocumented
  scripts, a stale `.dev.vars.example`, a relative link whose target is gone, an MCP tool
  or API path that ships without a mention in the README. If it fails, it names the exact
  drift. The claims it cannot judge are swept quarterly —
  [docs/housekeeping.md](./docs/housekeeping.md).
- Adding a root `package.json` script means documenting it in `README.md`,
  `docs/README.md` and `AGENTS.md` — the check requires all three.
- Changing an API route means regenerating the spec with `pnpm api:spec` and adding the
  matching MCP tool.

## Pull requests

- Keep the diff to one concern. A refactor small enough to ride inside the change it
  enables is welcome; one too big for that deserves its own PR.
- Say **why** in the description, not just what. If you deviated from a documented
  pattern, argue for it there rather than leaving it to be discovered.
- Make sure `pnpm verify` passes locally before asking for review.
- Maintainers merge. Please do not merge your own PR, and note that only a maintainer can
  cut a release — releases are tag-triggered deploys, not a step in review.

## Code of conduct

Be decent to each other. Disagree about the code, not the person. Behaviour that makes
the project worse to participate in gets you removed from it.
