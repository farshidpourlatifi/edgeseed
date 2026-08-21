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
 * **Both pins have to be set here, at config load, and they work for two
 * different reasons.** Node re-reads `TZ` whenever it changes and rebuilds its
 * zone cache, so that one would take effect anywhere. It fixes the default
 * *locale* at startup instead and ignores a later assignment — so `LC_ALL`
 * works only because vitest runs test files in **forked** workers, and a fork
 * reads the inherited environment at its own startup. Set inside a running
 * test, `LC_ALL` does nothing at all; the process it would have to convince has
 * already booted.
 *
 * The practical consequence is that this file is the only place the locale can
 * be pinned. Prefixing the `test` script would work too, but a bare `vitest`
 * outside pnpm would then miss it, and a pin that depends on how the suite was
 * invoked is the kind that quietly stops applying.
 */
process.env.TZ = "America/Los_Angeles";
process.env.LC_ALL = "en-GB";

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
