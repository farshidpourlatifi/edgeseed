import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The unit suite runs **west** of UTC, where the Worker runs.
 *
 * The reason to pin at all is the same as Playwright's: a machine that agrees
 * with the Worker cannot tell a pinned formatter from one that asks the runtime
 * for its zone, so the assertion passes against both and the bug ships. CI is
 * UTC, which is precisely the agreeing case.
 *
 * The reason to pin *west* rather than reuse Playwright's `Pacific/Kiritimati`
 * is that `format-date.test.ts` re-imports the module under UTC+14 to prove the
 * zone pin holds, and opens with a sanity check that the process really moved.
 * Pinning the suite to that same zone would make the check vacuous — it would
 * already be there — and the case would then pass whether or not the re-import
 * did anything. `America/Los_Angeles` is UTC-7/-8, so the two suites break the
 * day boundary in opposite directions and neither swallows the other.
 *
 * **Assigning it here works; the locale equivalent would not.** Node re-reads
 * `TZ` whenever it changes and rebuilds its zone cache, so a value set at
 * config load reaches every worker process. It fixes the default *locale* at
 * startup instead, and ignores a later `LANG`/`LC_ALL` — pinning that would
 * mean prefixing the `test` script, which a bare `vitest` would then miss. The
 * locale half is therefore Playwright's job, which is where a locale mismatch
 * actually breaks something (hydration), plus the explicit `en-GB` comparison
 * `format-date.test.ts` builds by hand.
 */
process.env.TZ = "America/Los_Angeles";

export default defineConfig({
  resolve: {
    alias: {
      // `~/` is apps/web's own alias, declared in its tsconfig and resolved by
      // Vite when the app builds. Tests run from the root against this config
      // instead, which knows nothing of it — so importing a web component here
      // fails on the first `~/` in its import graph. No other package uses the
      // prefix, so pointing it at apps/web/app is unambiguous.
      "~": fileURLToPath(new URL("./apps/web/app", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // `.test.ts` only, deliberately. `stryker.config.json` excludes
    // `.react-router` from its crawl on the strength of this: the generated
    // route types are consumed exclusively by `import type` in `.tsx` route
    // modules, which nothing here collects (AGENTS.md, issue #30). Widening
    // this to `.tsx` would invalidate that reasoning.
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**", "apps/web/app/**", "apps/web/server/**", "apps/mcp/src/**"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "packages/db/migrations/**"],
    },
  },
});
