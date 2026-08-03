import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/build/**",
      "**/dist/**",
      "**/.react-router/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.stryker-tmp/**",
      "**/reports/**",
      "docs/api/**",
      "packages/db/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Allow intentionally-unused args/vars when underscore-prefixed
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // shadcn-derived hooks intentionally sync state from browser APIs after
    // hydration (SSR-safe init); revisit if theme moves to server-side cookies
    files: ["packages/ui/src/hooks/**"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // Node-side scripts (CLI tooling) may use process, console, etc.
    files: ["packages/cli/**"],
    languageOptions: { globals: { ...globals.node } },
  },
  // Must be last: disables stylistic rules that conflict with Prettier
  prettier,
);
