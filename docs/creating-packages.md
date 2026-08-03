# Creating a New Package

Checklist for adding a workspace package. Follow it in order — half-wired
packages (installed but no script, exported but no consumer) are how tooling
silently rots.

## 1. Scaffold

```
packages/<name>/
  package.json
  CLAUDE.md
  src/
    index.ts
    __tests__/
```

`package.json` skeleton:

```json
{
  "name": "@starter/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- **Scope**: `@starter/*` is for starter-owned framework packages only.
  Product packages in downstream repos use the product's own scope (e.g.
  `@acme/*`) — the full ownership model is in `docs/starter-as-upstream.md`.
- Export TS source directly (`./src/index.ts`) — consumers compile it; there is
  no per-package build step.
- Add subpath exports (`"./thing": "./src/thing.ts"`) instead of barrel-exporting
  everything through index when consumers need distinct entry points (see
  `@starter/auth` for the pattern).

## 2. Wire dependencies

- Consumers declare `"@starter/<name>": "workspace:*"` in their `package.json`
  (devDependency if only used by tests), then `pnpm install`.
- Never deep-import another package's files by relative path across package
  boundaries — go through its `exports`.

## 3. Type checking

Packages have no standalone `typecheck` script — they are checked through the
app that consumes them (`pnpm typecheck` runs the apps). If the package needs
DOM types (UI code), it must be consumed by `apps/web` to be checked, like
`@starter/ui`.

## 4. Tests

- Unit tests in `src/__tests__/*.test.ts` — the root vitest config picks up
  `packages/**/*.test.ts` automatically, nothing to register.
- Use the shared helpers: `@starter/cli/test-helpers/fake-env` and
  `.../factory`.
- Add the package's source globs to `mutate` in `stryker.config.json` if it
  contains logic (not just config/types).

## 5. CLAUDE.md (required)

Every package carries a `CLAUDE.md` covering: why it exists, layout, rules
specific to the package, and its **test coverage target**. Copy the structure
from `packages/config/CLAUDE.md` (smallest example). Keep it under ~40 lines —
it's context for future sessions, not marketing.

## 6. Finish

- Update the Project Structure tree in the root `README.md`
- `pnpm verify` must pass before committing
