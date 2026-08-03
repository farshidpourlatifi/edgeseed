# Route Examples

These are reference implementations generated with V0 and adapted for React Router.
They are **not registered as routes** — they exist as copy-paste starting points.

## How to use an example

1. Copy the file to `app/routes/` (e.g., `cp _examples/dashboard-with-widgets.tsx ../dashboard._index.tsx`)
2. Register the route in `app/routes.ts` if it's a new route
3. Run `npx react-router typegen` to generate types
4. Wire real data in the loader (replace static arrays with DB queries)

## Available examples

| File                         | What it shows                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `dashboard-with-widgets.tsx` | Stats cards, activity table with empty state, quick action cards                           |
| `settings-full.tsx`          | Tabbed settings (General/Team/Billing), profile with avatar, danger zone, team member list |

## Generating new designs with V0

This project uses V0 (shadcn) for UI generation.

**V0 project:** https://v0.app/chat/cf-starter-TfaLZ8bWtZH
**shadcn preset:** https://ui.shadcn.com/create?preset=b5KbFbLGd

### Workflow

1. Open the V0 project link above (or start a new chat at v0.dev)
2. Describe the page/component you need. Always include:
   - "Use shadcn/ui components and Tailwind CSS v4"
   - "Apply the theme from this preset: https://ui.shadcn.com/create?preset=b5KbFbLGd"
   - "Support dark mode via .dark class on html"
   - "All touch targets min 44px on mobile"
   - "Use Lucide React icons"
3. Ask for loading states, error states, empty states, and mobile responsiveness
4. Download the V0 output to your local machine
5. Tell Claude the download path — Claude will:
   - Pick the components and pages needed
   - Convert Next.js patterns to React Router (Link, usePathname, useRouter)
   - Replace `next-themes` with our `use-theme.tsx` hook
   - Wire auth data from loaders (replace hardcoded "John Doe" etc.)
   - Copy new shadcn components to `packages/ui/src/components/ui/`
   - Adapt imports from `@/components/ui/X` to `@starter/ui/components/ui/X`

### What V0 generates vs what we use

V0 outputs a Next.js app. We only take:

- `components/ui/*.tsx` → new shadcn primitives go to `packages/ui/src/components/ui/`
- `app/**/page.tsx` → adapted to React Router route files in `app/routes/`
- `app/globals.css` → theme variables (if changing theme)

We ignore: `next.config.mjs`, `package.json`, `tsconfig.json`, `components/theme-provider.tsx` (we have our own).

## shadcn component gallery

For visual reference of what patterns are available with this preset (charts, forms, sidebars, empty states, calendars, tables, etc.), browse:

https://ui.shadcn.com/create?preset=b5KbFbLGd&item=preview

This shows rendered card examples using our exact theme. When building a new feature, look here first to find a matching pattern, then ask V0 to generate it as a React component.
