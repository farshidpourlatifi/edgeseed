# Design Workflow (V0 + shadcn)

> **Product-owned file.** Like `apps/*`, this file belongs to the product layer
> (see `docs/starter-as-upstream.md`). The starter ships it with the starter's
> own V0 project and theme as working defaults — when you spin a product repo
> off this starter, replace the URLs, theme preset, and prompt template with
> your product's own. Upstream won't touch this file after v1.

## Current design sources

| What                                            | Where                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- |
| V0 project (generate new pages/components here) | https://v0.app/chat/cf-starter-TfaLZ8bWtZH                 |
| shadcn theme preset                             | https://ui.shadcn.com/create?preset=b5KbFbLGd              |
| Component gallery (visual reference)            | https://ui.shadcn.com/create?preset=b5KbFbLGd&item=preview |

## Prompt template

Include this block in every V0 generation (swap the preset URL if you change
the theme):

```
Use shadcn/ui components, Tailwind CSS v4, and React. Use Lucide React icons.
Apply the theme from this preset: https://ui.shadcn.com/create?preset=b5KbFbLGd
Support dark mode via .dark class on <html> using CSS variables.
All touch targets must be at least 44px on mobile.
Include loading states, error states, and empty states.
Make it fully responsive (mobile 320px, tablet 768px, desktop 1280px).
```

## Integration workflow

1. Generate the design in your V0 project
2. Download the output locally
3. Tell Claude the download path — Claude will:
   - Pick only the components and pages needed
   - Convert Next.js to React Router (`Link`, `usePathname` → RR equivalents)
   - Replace `next-themes` with `packages/ui/src/hooks/use-theme.tsx`
   - Remove `"use client"` directives (not needed in React Router)
   - Wire real data from loaders (replace hardcoded user data)
   - Fix imports (`@/lib/utils` → relative, `@/components/ui/X` → `./X`)

## Where generated code goes (respect the ownership layers)

- **Pages** → `apps/web/app/routes/` (product zone — yours)
- **Generic shadcn primitives** (button, combobox, …) → `packages/ui/src/components/ui/`
  — in the **starter repo only**. In a product repo, `@starter/ui` is read-only:
  contribute the primitive upstream if it's generic, otherwise put it in your
  product UI package (e.g. `@acme/ui`, created via `docs/creating-packages.md`)
- **Product-specific composites** → your product UI package, always

## Changing look and feel without touching the framework

The theme is CSS-variable-based: all `@starter/ui` components consume variables
defined in `apps/web/app/app.css` (product zone). To restyle the entire app,
generate a new preset at https://ui.shadcn.com/create, paste its variables into
`app.css`, and update the preset URL in this file — no `@starter/*` edits needed.

## What to ignore from V0 output

- `next.config.mjs`, `package.json`, `tsconfig.json` — the repo has its own
- `components/theme-provider.tsx` / `theme-toggle.tsx` — already exist in `@starter/ui`
- `app/globals.css` — take theme variables only, into `app.css`
