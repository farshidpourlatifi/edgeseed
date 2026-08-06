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
