# CLAUDE.md

**`AGENTS.md` is the single source of truth for this repository.** It is imported
below, so everything in it applies here. Do not copy project knowledge into this
file — add it to `AGENTS.md` instead, or the two will drift and the wrong one
will be trusted.

@AGENTS.md

---

## Claude Code specifics

Only things that exist because of Claude Code belong below this line.

### Preview servers

`.claude/launch.json` defines the dev servers for the Browser pane. Start them
with the preview tooling, never `pnpm dev` in a shell — a shell-started server
is not tracked and outlives the session:

| Name  | Port | What it runs                      |
| ----- | ---- | --------------------------------- |
| `web` | 5173 | `react-router dev` (Vite)         |
| `mcp` | 8788 | `wrangler dev` for the MCP Worker |

Stop every preview before `pnpm test:e2e`. An orphaned `react-router dev` bound
IPv6-only (`[::1]:5173`) makes Playwright fail with `ERR_CONNECTION_REFUSED`,
because it reuses the occupied port while the resolver pin targets `127.0.0.1`.
Check with `lsof -nP -iTCP:5173 -sTCP:LISTEN` when e2e fails for no clear reason.

**Stop the `mcp` preview too.** `organization-lifecycle.spec.ts` starts its own
MCP Worker on 8788 for the tenant-isolation deny path, and one already listening
there means the spec drives a Worker it did not configure — including one still
holding the D1 that global-setup's `db:reset` is about to drop. Check both ports:
`lsof -nP -iTCP:5173,8788 -sTCP:LISTEN`.

### Per-directory context

Each app and package has its own `CLAUDE.md`, which Claude Code loads when
working in that directory. They hold directory-specific rules and coverage
targets — read the relevant one before changing code there.

These are still named `CLAUDE.md` rather than `AGENTS.md`; renaming them would
mean rewriting references inside `docs/security-audit.md` and
`docs/security-plan.md`, which are point-in-time records.

### Verifying the import

Claude Code resolves `@AGENTS.md` above at session start. If `AGENTS.md` content
is not present in context, the import did not resolve — say so rather than
working from this file alone, since it deliberately holds almost nothing.

### Before reporting a branch as ready to push

The rule lives in `AGENTS.md`, "A new branch must never inherit `main` as its
upstream" — read it there; it is not restated here, because two copies drift and
the wrong one gets trusted. What belongs here is the habit it demands of a
session that just created a branch and is about to hand work back:

```bash
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

Run it before saying the words "ready to push". `origin/main` is the failure —
it means a bare `git push` will write to `main`, and it is how
`feat/org-referential-integrity` landed on `main` on 2026-08-12. "no upstream"
is fine and is the safer state.

Read the output of `git checkout -b` rather than skimming it. Git prints
`branch '<name>' set up to track '<ref>'` and that line is the whole answer;
that failure was announced in plain text and went unread. Hand the human
`git push -u origin <name>`, never a bare `git push`.
