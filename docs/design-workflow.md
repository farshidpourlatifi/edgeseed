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

## Hero poster

The landing hero paints a still of the shader's **frame 0** before the canvas
mounts (`apps/web/app/components/landing/hero-poster.css`), so the server render
and the first animated frame are the same image and there is no pop on hydration.
It is also the only composition a browser without WebGL2 ever sees.

The stills are captures of specific shader parameters, so they go stale silently
— a stale poster still looks like a plausible gradient. `POSTER_FINGERPRINT` in
`hero-shader.ts` is asserted against the live parameters by
`hero-shader.test.ts`, so **CI fails when a colour, `distortion`, `swirl`,
`rotation`, `fit` or the world box changes** and the poster was not regenerated.
That test is the only automatic guard: comparing pixels needs WebGL2, which
neither vitest nor Playwright's headless Chromium has (`tests/e2e/CLAUDE.md`).

### Regenerating

Frame 0 is `u_time = 0` regardless of `speed`, so freezing the shader is enough.

1. In `hero-background.tsx`, temporarily replace the `speed` prop with
   `speed={0} frame={0} webGlContextAttributes={{ preserveDrawingBuffer: true }}`
   — without `preserveDrawingBuffer` the buffer is cleared before you can read
   it — and set the style to `{{ width: 1600, height: 900 }}` so the canvas is
   exactly 16:9 and shows the **whole** world rather than a cover-crop of it.
2. Load `/` in a browser that has WebGL2 and is **visible** — the library sizes
   its canvas from a `ResizeObserver`, which does not deliver in a hidden tab, so
   a background tab leaves the canvas at 0x0.
3. Capture each theme (toggle via the `theme` cookie, then open a fresh tab —
   a hard reload can leave the fixed-size canvas at 0x0):

   ```js
   const canvas = document.querySelector('[data-testid="hero-background"] canvas');
   const out = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
   out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
   out.toDataURL("image/webp", 0.92);
   ```

4. Paste each data URI into `hero-poster.css`, revert the temporary props, and
   update `POSTER_FINGERPRINT`.

### What "matches" means

Measured against the live shader at frame 0 by mean absolute channel difference:

| Viewport             | Mean  | Max |
| -------------------- | ----- | --- |
| 1280x720 (near 16:9) | 0.52  | 9   |
| 375x812 (portrait)   | 11.44 | 186 |

The framing is exact at every aspect ratio — the shader cover-crops a 16:9 world
and `background-size: cover` crops a 16:9 still by the same rule, confirmed by
the same measurement against `contain` scoring 135.74. The residual at portrait
is the still being upscaled ~4x into a narrow crop, which softens the diagonal
edge; the composition does not move, and the two are indistinguishable
side by side. Raise the stored resolution above 640x360 if that ever matters.
