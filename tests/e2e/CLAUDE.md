# tests/e2e

## Locator convention

Priority order, same as Playwright's own guidance:

1. **`getByRole` / `getByLabel`** — the default. These select through the
   accessibility tree, so every locator doubles as an a11y assertion: a button
   that loses its accessible name fails the test, as it should.
2. **`getByText`** — for prose that has no role. Sparingly.
3. **`getByTestId`** — escape hatch, only for elements no role locator can
   reach (the terminal's animated body is `aria-hidden`; its accessible
   transcript is a separate element). The `data-testid` is added at the
   component — read `packages/ui/CLAUDE.md` before adding one.
4. **Never CSS class or structure selectors** (`.tw`, `div > span`) — they
   couple tests to styling and break on refactors with no behavior change.

Page-anchor ids (`#quality`, `#terminal-demo`) are stable navigation targets
and acceptable as region scopes; the element inside is still selected by role
or testid.

## Running

- `pnpm test:e2e` from the root. **Stop dev servers first** — global-setup
  runs `db:reset`, and a server holding the D1 file or port 5173 produces
  `SQLITE_CANTOPEN` / `ERR_CONNECTION_REFUSED` that look like code regressions
  (details in the root AGENTS.md).
- Playwright boots its own web server (`webServer` in `playwright.config.ts`),
  pinned to `127.0.0.1` — do not change `port` to `url` there; the comment in
  the config explains why.
- Tests use a per-run throwaway user (`helpers.ts`); never point this suite at
  a deployed environment.

## Testing a loader guard

**Use `?_routes=` to reach a child loader on its own.** Single fetch resolves
every matched loader in one request and **any** of them redirecting
short-circuits the whole payload — so a plain `/dashboard/settings.data` request
is satisfied by the dashboard _layout's_ guard and keeps passing with the child
wide open. `?_routes=routes%2Fdashboard.settings` asks for one loader by id
without its parent, which is the request a child guard has to answer alone, and
the vector audit #10 is about (`loader-guards.spec.ts`).

**Assert on the payload, not the status.** An unauthenticated `.data` request
answers **202** with the redirect encoded in the body as `SingleFetchRedirect` —
checking for a 302, or merely "not 200", passes without proving anything.

Both were verified by removing the guard in a throwaway worktree and confirming
the suite goes red; a guard test that has never been seen to fail is a guess.
