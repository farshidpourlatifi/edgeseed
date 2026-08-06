# Design Workflow (V0 + shadcn)

> **Product-owned file.** Like `apps/*`, this file belongs to the product layer
> (see `docs/starter-as-upstream.md`). The starter ships it with the starter's
> own V0 project and theme as working defaults — when you spin a product repo
> off this starter, replace the URLs, theme preset, and prompt template with
> your product's own. Upstream won't touch this file after v1.

## Current design sources

| What                                             | Where                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| V0 project (generate new pages/components here)  | https://v0.app/chat/cf-starter-TfaLZ8bWtZH                 |
| V0 project instructions (paste into the project) | [v0-project-instructions.md](./v0-project-instructions.md) |
| shadcn theme preset                              | https://ui.shadcn.com/create?preset=b5KbFbLGd              |
| Component gallery (visual reference)             | https://ui.shadcn.com/create?preset=b5KbFbLGd&item=preview |

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

**Drop the loading/error/empty line for static marketing sections.** It is aimed
at data-driven UI; on a landing section V0 satisfies it by building a control
that switches between the states — a design-system demo shipped as a product
feature. Keep the line for dashboards, forms, and anything that fetches.

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

## Dark-mode primary override

The current preset (`b5KbFbLGd`) ships a dark `--primary` of `oklch(0.443 0.11 240.79)`,
which is _darker_ than the light-mode primary — buttons, the logo, icons and numbered
badges go muddy against the dark background. `app.css` overrides the `.dark` block with
the lighter pair (mirroring the preset's own dark `--sidebar-primary`, which gets this
right):

```css
--primary: oklch(0.685 0.169 237.323);
--primary-foreground: oklch(0.293 0.066 243.157);
```

The V0 project applied the same fix on 2026-08-04 ("Fixed dark primary", v7), so V0
downloads generated from v7 onward carry the corrected values. The **preset URL is
frozen with the old value** — re-apply this override whenever theme variables are
re-imported from the preset, and if the V0 theme ever resets, paste this prompt there:

```
In this project's theme, dark mode's --primary is wrong: it is
oklch(0.443 0.11 240.79), which is DARKER than the light-mode primary
oklch(0.5 0.134 242.749), so primary buttons, the logo, icons and
numbered badges look muddy against the dark background.

Update ONLY these two tokens in the .dark block:

  --primary: oklch(0.685 0.169 237.323);
  --primary-foreground: oklch(0.293 0.066 243.157);

This mirrors the dark --sidebar-primary / --sidebar-primary-foreground
pair already in the theme (the preset gets this right for the sidebar).
Do not change the light theme, chart colors, or any other tokens.
Use this corrected theme for all future generations in this project.
```

## What to ignore from V0 output

- `next.config.mjs`, `package.json`, `tsconfig.json` — the repo has its own
- `components/theme-provider.tsx` / `theme-toggle.tsx` — already exist in `@starter/ui`
- `app/globals.css` — take theme variables only, into `app.css`
- **Invented product content.** V0 fills tabs and cards with plausible fiction
  (`projects.create`, `starter projects create …`) that reads as real and gets
  shipped by mistake. Replace every command, route and tool name with one that
  exists, or the section documents a product you do not have.
- **Loading/error/empty variants on static sections.** The prompt template's
  "include loading states, error states, and empty states" line is aimed at
  data-driven UI; on a marketing section V0 answers it with a literal state
  switcher. Drop the line for static sections, and delete the control if it
  appears anyway.
- **Hardcoded palette colors** (`bg-zinc-950`, `border-white/10`). They survive
  a dark-mode screenshot and break in light mode. Swap for semantic tokens.
- **Components the repo does not have.** V0 assumes the full shadcn set;
  `@starter/ui` ships a subset. Check before adapting — the generated code may
  import a primitive that has to be added deliberately, or designed around.
- **Edits to files you supplied.** When real source files are provided so
  imports resolve, V0 treats them as its own and rewrites them. Observed on
  2026-08-06: it flipped `useInView`'s fail-open `useState(true)` back to
  `false` and dropped `useReducedMotion`'s `matchMedia` guard — both defensive
  choices whose comments explain why. **Diff every supplied file before taking
  a download**, and take none of those edits:

  ```bash
  diff -q packages/ui/src/components/ui/terminal.tsx "$DL/components/ui/terminal.tsx"
  ```

- **Minified rewrites of existing components.** The same download renamed
  `architecture-diagram.tsx` to `request-flow-diagram.tsx` and flattened 287
  readable lines into one 5,005-character line — identical `viewBox` and
  `aria-label`, no new content. Keep the original.
