import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
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
