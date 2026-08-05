# @starter/ui

## Why this exists

The design system: shadcn/ui components, layout primitives, theme hooks, and
`cn()`. Apps import via `@starter/ui/components/ui/*` — components are never
copied into apps.

## Layout

- `src/components/ui/` — shadcn primitives (vendor-ish; keep close to upstream, regenerate via V0/shadcn rather than hand-editing heavily)
- `src/components/ui/terminal.tsx` — our own animated scripted-terminal player (marketing/docs pages). View layer only; the animation model is `terminal-timeline.ts` (pure functions: `buildTimeline`, `stateAt`, `keyOf`, `transcriptOf`) and is unit + mutation tested. Honors reduced-motion, pauses off-screen, themes via `--term-*` CSS vars with `color-scheme` bound to the `.dark` class. `animate={false}` renders the finished transcript statically — use it wherever a code-block-style terminal snippet should match the animated chrome
- `src/components/layout/` — our own primitives (page-shell, empty-state, loading-state, stack)
- `src/hooks/` — `use-theme` (light/dark/system via cookie), `use-mobile`, `use-toast`, `use-in-view` (IntersectionObserver, fails open), `use-reduced-motion`
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)

## Rules

- Components use the unified `radix-ui` package, NOT individual `@radix-ui/react-*` packages
- `data-testid` goes on a component only when an e2e test must target an element
  no role locator can reach (the terminal root and its `aria-hidden` body carry
  `terminal` / `terminal-body` for exactly this). Never add testids
  preemptively — role and label locators are the primary hook, and replacing
  them with a testid hides a11y regressions (`tests/e2e/CLAUDE.md`)
- New components come from V0/shadcn generation (see root CLAUDE.md), then get import fixes — don't write shadcn-style components from scratch
- This package is typechecked through the web app (it needs DOM types), not standalone
- ESLint: `react-hooks/set-state-in-effect` is disabled for `src/hooks/` only — the SSR-safe init pattern there is intentional; don't copy that pattern into app code

## Testing

- **Coverage target: `src/lib/` and `terminal-timeline.ts` 100%; React components and hooks have no unit target** — they're exercised by e2e and visual review. When adding animated/stateful components, follow the terminal pattern: extract the logic into a pure `.ts` module and test that
- Don't write snapshot tests for shadcn components; they churn on every upstream regeneration
