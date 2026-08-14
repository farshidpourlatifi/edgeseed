import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
