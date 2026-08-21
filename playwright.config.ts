import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: "list",
  use: {
    // Stays on `localhost` so the page origin keeps matching BETTER_AUTH_URL —
    // Better Auth rejects requests whose Origin is not a trusted origin, and
    // 127.0.0.1 is a different origin. The resolver rule below is what makes
    // that name land on the address the dev server is actually bound to.
    baseURL: "http://localhost:5173",
    // The browser is pinned to disagree with the Worker on **both** axes, so a
    // date rendered by anything other than the pinned seam comes out different
    // on the two sides of hydration.
    //
    // That makes the mismatch *observable*; it does not observe it. React
    // reports one by logging an error and re-rendering the subtree, so a spec
    // that asserts nothing about the value and installs no listener still
    // passes. `watchForHydrationFailures` in `tests/e2e/helpers.ts` is the
    // watching half, and the specs for both pages that render dates —
    // `members.spec.ts` and `api-tokens.spec.ts` — use it. A new page that
    // renders a date adds it too; `tests/e2e/CLAUDE.md` carries that rule.
    //
    // The Worker is UTC and answers `en-US`. Left alone, CI's Chromium answers
    // exactly the same two things — so a formatter that asks the *runtime* for
    // its locale or zone produces identical output on both sides, the mismatch
    // exists only on a reader's machine, and CI reports green. That is not
    // hypothetical: it is how the defect `app/lib/format-date.ts` exists to
    // prevent reached a browser twice, in the members list and again in the
    // API-token list.
    //
    // `Pacific/Kiritimati` is UTC+14, the furthest ahead there is, so a
    // timestamp anywhere in the last fourteen hours of a UTC day lands on the
    // *next* calendar day here. `en-GB` renders "15 Aug 2026" where `en-US`
    // renders "Aug 15, 2026". Both were targeted precedents before they were
    // suite-wide — `format-date.test.ts` and `members.spec.ts` respectively.
    //
    // `hostile-environment.spec.ts` is what fails if either line is deleted;
    // it deliberately restates these values rather than importing them, since
    // a shared constant would move with the edit and assert nothing.
    timezoneId: "Pacific/Kiritimati",
    locale: "en-GB",
    trace: "on-first-retry",
    launchOptions: {
      args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
    },
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  // One `webServer`, deliberately. The MCP Worker is booted by
  // `organization-lifecycle.spec.ts` itself rather than declared here, for two
  // reasons that only showed up when it was declared here:
  //
  // 1. **Two miniflare instances cannot initialise one `--persist-to` root at
  //    the same time.** Playwright starts every `webServer` entry in parallel,
  //    and the MCP Worker shares `apps/web/.wrangler/state` so it can read the
  //    D1 the browser writes. Racing the web server for it, it dies at boot
  //    with `Directory named "cache:storage" not found` → `The Workers runtime
  //    failed to start` — a message about a directory that demonstrably exists.
  //    Started after the web server is up, it is reliable.
  // 2. **`webServer` is not scoped to a project or a `-g` filter.** Declared
  //    here, `pnpm test:e2e -g favicon` would compile a Worker and open a
  //    Durable Object namespace for a test that never touches MCP.
  //
  // Must stay `port`, not `url`: with `url` Playwright boots the server before
  // globalSetup, and globalSetup's db:reset then drops the D1 file out from
  // under it — every auth call fails with SQLITE_CANTOPEN.
  webServer: {
    // `--host 127.0.0.1` pins the bind address. Left to itself the dev server
    // binds whichever family DNS returns for `localhost` first — sometimes
    // 127.0.0.1, sometimes [::1] — while the browser races the same lookup
    // independently. When the two disagree the suite dies on ERR_CONNECTION_
    // REFUSED. This only affects test runs; `pnpm dev` is untouched.
    command: "pnpm --filter @starter/web dev --host 127.0.0.1",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    // Compiles every route once so Vite's dep pre-bundling (and the page
    // reload it triggers) happens before any test is asserting. See
    // tests/e2e/warmup.setup.ts.
    {
      name: "warmup",
      testMatch: /warmup\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /warmup\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["warmup"],
    },
  ],
});
