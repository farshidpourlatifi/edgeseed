# Cloudflare Starter Kit

## What this is

Cloudflare-native monorepo starter for shipping SaaS products fast. See `docs/starter-v1-scope.md` for the full V1 spec.

## Stack

- **Runtime:** Cloudflare Workers (D1, KV, etc.)
- **Web:** React Router v7 + Hono + Tailwind v4
- **Auth:** Better Auth (email/password + org/tenancy)
- **DB:** Drizzle ORM on D1 (SQLite)
- **UI:** shadcn/ui components (unified `radix-ui` package, not individual `@radix-ui/*`)
- **Theme:** Single oklch preset from shadcn (light/dark/system), no multi-color switcher
- **Toasts:** Sonner (mounted at root layout)
- **MCP:** MCP server scaffold in `apps/mcp`

## Monorepo layout

```
apps/web          — React Router app (Cloudflare Workers)
apps/mcp          — MCP server (Cloudflare Workers)
packages/auth     — Better Auth config, middleware, session/role helpers
packages/config   — Zod-validated env schemas, version
packages/db       — Drizzle schema, migrations, D1 client
packages/ui       — shadcn/ui components, hooks, theme
packages/cli      — Dev workflow scripts (db:*, api:spec, version:bump)
docs/             — ADRs, API specs
tests/e2e         — Playwright e2e tests
```

## Key architecture decisions

### Web app server layer

`apps/web/server/index.ts` is a Hono app that:
- Runs `authMiddleware` to create db + auth per request
- Mounts Better Auth at `/api/auth/**`
- Mounts versioned API at `/api/v1`
- Passes `db` and `auth` to React Router loaders via `load-context.ts`

### Routes

Defined in `apps/web/app/routes.ts` (explicit route config, not file-based routing):
- `/` — landing page
- `/login` — email/password + GitHub social login
- `/register` — with confirm password validation
- `/dashboard` — layout with sidebar, topbar, auth guard
- `/dashboard/settings` — profile (name/email)

When adding a new dashboard page: add the route in `routes.ts`, create the file in `app/routes/`, then run `npx react-router typegen` to generate types.

### UI components

All in `packages/ui/src/components/ui/`. Imported as `@starter/ui/components/ui/button` etc.

Components use the unified `radix-ui` package (e.g., `import { Dialog } from "radix-ui"`), NOT individual packages like `@radix-ui/react-dialog`.

Theme is CSS-variable-based (oklch colors) defined in `apps/web/app/app.css`. The `ThemeProvider` in `packages/ui/src/hooks/use-theme.tsx` manages light/dark/system via cookies.

### Dashboard layout

The dashboard has:
- **Sidebar** (desktop): collapsible, org switcher dropdown, nav links with active state, user dropdown, collapse button with tooltips
- **Topbar**: breadcrumbs (desktop), hamburger dropdown (mobile), theme toggle, notification bell, user menu (mobile)
- All sidebar/topbar code is inline in `dashboard.tsx` — not separate component files

### Auth in loaders

Dashboard layout loader fetches session and orgs:
```ts
const session = await context.auth.api.getSession({ headers: request.headers });
const orgs = await context.auth.api.listOrganizations({ headers: request.headers });
```

The loader returns `{ user, activeOrganizationId, organizations }` — child routes access user data through the parent layout.

### Social login (GitHub + Google)

Login/register pages have GitHub and Google social login buttons. To enable:

1. Set env vars in `wrangler.jsonc` (or Cloudflare dashboard for production):
   - `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` — get from https://github.com/settings/developers
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — get from https://console.cloud.google.com/apis/credentials
2. Providers are auto-enabled when their credentials are set (conditional in `packages/auth/src/server.ts`)
3. For GitHub: set callback URL to `{BETTER_AUTH_URL}/api/auth/callback/github`
4. For Google: set authorized redirect URI to `{BETTER_AUTH_URL}/api/auth/callback/google`

## Dev commands

```bash
pnpm dev                    # Start web app dev server
pnpm db:generate            # Generate Drizzle migration
pnpm db:migrate             # Apply migrations (local)
pnpm db:seed                # Seed dev data
pnpm db:reset               # Drop and re-apply all migrations
pnpm api:spec               # Generate OpenAPI spec
pnpm version:bump [type]    # Bump version (patch/minor/major)
pnpm test                   # Run Vitest
pnpm test:e2e               # Run Playwright
```

## TypeScript notes

- Web app tsconfig uses `@cloudflare/workers-types/experimental` + DOM lib
- `worker.ts` imports `./build/server` which only exists after `pnpm build` — this typecheck error is expected pre-build
- Route types are generated into `.react-router/types/` via `rootDirs`
- UI package is typechecked through the web app (not separately) since it needs DOM types

## Conventions

- **Adding a page:** Add route in `routes.ts` → create route file → run `npx react-router typegen`
- **Adding a UI component:** Place in `packages/ui/src/components/ui/` → import from `@starter/ui/components/ui/name`
- **Adding an API route:** Add to `apps/web/server/api.ts` with OpenAPI schema → add matching MCP tool in `apps/mcp`
- **Auth guard:** Use `redirect("/login")` in loader if no session (see `dashboard.tsx` loader pattern)
- **Toast notifications:** `import { toast } from "sonner"` — Toaster is already mounted at root

## Route examples

`apps/web/app/routes/_examples/` contains reference implementations — rich UI pages that are NOT registered as routes. They exist as copy-paste starting points when building a product.

| File | What it shows |
|------|--------------|
| `dashboard-with-widgets.tsx` | Stats cards, activity table with empty state, quick action cards |
| `settings-full.tsx` | Tabbed settings (General/Team/Billing), profile with avatar upload, danger zone, team member list |

To use an example: copy it to `app/routes/`, register the route in `routes.ts`, run `npx react-router typegen`, wire real data.

See `_examples/README.md` for full instructions.

## Generating new UI with V0

This project uses V0 (shadcn) for UI generation instead of writing UI from scratch.

**V0 project:** https://v0.app/chat/cf-starter-TfaLZ8bWtZH
**shadcn preset:** https://ui.shadcn.com/create?preset=b5KbFbLGd
**Component gallery:** https://ui.shadcn.com/create?preset=b5KbFbLGd&item=preview (visual reference for charts, forms, sidebars, tables, empty states, etc.)

### V0 prompt template

When generating new pages/components in V0, always include:

```
Use shadcn/ui components, Tailwind CSS v4, and React. Use Lucide React icons.
Apply the theme from this preset: https://ui.shadcn.com/create?preset=b5KbFbLGd
Support dark mode via .dark class on <html> using CSS variables.
All touch targets must be at least 44px on mobile.
Include loading states, error states, and empty states.
Make it fully responsive (mobile 320px, tablet 768px, desktop 1280px).
```

### Integration workflow

1. Generate the design in V0 (at https://v0.app/chat/cf-starter-TfaLZ8bWtZH)
2. Download the V0 output to a local folder
3. Tell Claude the download path — Claude will:
   - Pick only the components and pages needed
   - Convert Next.js to React Router (`Link`, `usePathname` → React Router equivalents)
   - Replace `next-themes` with our `use-theme.tsx` hook
   - Replace `"use client"` directives (not needed in React Router)
   - Wire auth data from loaders (replace hardcoded user data)
   - Copy new shadcn components to `packages/ui/src/components/ui/`
   - Fix imports: `@/lib/utils` → `../../lib/utils`, `@/components/ui/X` → `./X`
   - Fix `"radix-ui"` imports (V0 already uses the unified package)

### What to take from V0 output

- `components/ui/*.tsx` → new shadcn primitives to `packages/ui/src/components/ui/`
- `app/**/page.tsx` → adapted to React Router route files
- `app/globals.css` → theme variables only if changing the theme

### What to ignore from V0 output

- `next.config.mjs`, `package.json`, `tsconfig.json` — we have our own
- `components/theme-provider.tsx` — we have `packages/ui/src/hooks/use-theme.tsx`
- `components/theme-toggle.tsx` — we have `packages/ui/src/components/ui/theme-toggle.tsx`
