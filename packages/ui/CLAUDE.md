# @starter/ui

## Why this exists

The design system: shadcn/ui components, layout primitives, theme hooks, and
`cn()`. Apps import via `@starter/ui/components/ui/*` — components are never
copied into apps.

## Layout

- `src/components/ui/` — shadcn primitives (vendor-ish; keep close to upstream, regenerate via V0/shadcn rather than hand-editing heavily)
- `src/components/layout/` — our own primitives (page-shell, empty-state, loading-state, stack)
- `src/hooks/` — `use-theme` (light/dark/system via cookie), `use-mobile`, `use-toast`
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)

## Rules

- Components use the unified `radix-ui` package, NOT individual `@radix-ui/react-*` packages
- New components come from V0/shadcn generation (see root CLAUDE.md), then get import fixes — don't write shadcn-style components from scratch
- This package is typechecked through the web app (it needs DOM types), not standalone
- ESLint: `react-hooks/set-state-in-effect` is disabled for `src/hooks/` only — the SSR-safe init pattern there is intentional; don't copy that pattern into app code

## Testing

- **Coverage target: `src/lib/` 100%; components and hooks have no unit target** — they're exercised by e2e and visual review
- Don't write snapshot tests for shadcn components; they churn on every upstream regeneration
