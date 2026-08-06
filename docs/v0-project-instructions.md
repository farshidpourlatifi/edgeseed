# V0 project instructions

Paste the block below into the V0 project's **Project Settings → Instructions**
(the field that applies to every chat in the project, not a single prompt). It
front-loads the house rules that were previously being re-litigated in every
generation and fixed by hand afterwards.

Keep it in sync when the component inventory changes — a stale list is worse
than none, because V0 will confidently use a primitive that no longer exists.
Regenerate the available-components line with:

```bash
ls packages/ui/src/components/ui/*.tsx | xargs -n1 basename | sed 's/.tsx//' | tr '\n' ' '
```

This file is **product-owned**: repos extending this starter replace it with
their own (see [starter-as-upstream.md](./starter-as-upstream.md)).

---

```
## Target framework

Output plain, standalone React components. This project is React Router v7 +
Vite on Cloudflare Workers — it is NOT Next.js.

- No "use client" directives
- No next/link, next/image, next/font, next/navigation, or any next/* import
- No App Router files (layout.tsx, page.tsx conventions)
- No theme provider — one already exists in the codebase
- Client-side interactivity is fine and needs no boundary; just use hooks

## Styling

Tailwind CSS v4 and shadcn/ui. Apply this theme preset:
https://ui.shadcn.com/create?preset=b5KbFbLGd

Use SEMANTIC THEME TOKENS ONLY. Never literal palette colors — they break light
mode, which this app supports via a .dark class on <html>.

- Yes: bg-background, bg-card, bg-muted, bg-muted/50, bg-primary,
  text-foreground, text-muted-foreground, text-primary-foreground,
  border, border-input, ring, bg-destructive
- No: bg-zinc-950, text-zinc-400, text-white, border-white/10, bg-black,
  hover:bg-white/10, or any bg-<color>-<number>

Fonts are Inter (UI and headings) and JetBrains Mono (code) — NOT Geist. A
font-heading utility exists and is used for headings. Assume monospace runs
wide: keep code samples under ~60 characters of visual width.

Radius: --radius is 0.625rem, with radius-sm/md/lg/xl/2xl/3xl/4xl derived from
it. Prefer rounded-lg and rounded-xl.

## Available components — IMPORTANT

Only these shadcn primitives exist in this codebase:

alert, alert-dialog, avatar, badge, breadcrumb, button, card, dialog,
dropdown-menu, empty, form, input, label, select, separator, sheet, skeleton,
sonner, spinner, table, tabs, terminal, textarea, theme-toggle, toast, tooltip,
visually-hidden

Anything else — including checkbox, switch, popover, progress, radio-group,
accordion, collapsible, command, toggle, toggle-group, button-group,
input-group, field, item, scroll-area, navigation-menu, carousel, chart,
calendar, sidebar, drawer, pagination — DOES NOT EXIST here.

If a design genuinely needs one, say so explicitly at the top of your response
so it can be added deliberately. Do not assume it is available, and do not
silently substitute a different component.

Radix is imported from the unified package: `import { Dialog } from "radix-ui"`.
Never from individual @radix-ui/react-* packages.

## Bespoke components — USE, never recreate

These are not shadcn primitives. They already exist, they are tested, and they
carry behaviour you cannot see in a screenshot (injected styles, animation
timing, reduced-motion handling, screen-reader transcripts). Do NOT rebuild
them, and do NOT approximate them with divs and Tailwind — compose with them.

### Terminal — the animated CLI box

import { Terminal } from "@starter/ui/components/ui/terminal";

<Terminal
  label="pnpm verify"
  script={[
    {
      cmd: "pnpm verify",
      out: [
        { text: "lint — eslint . clean", tone: "ok" },
        { text: "7 gates passed", tone: "accent" },
      ],
    },
  ]}
/>

Props: script (required), label, theme "auto"|"light"|"dark", animate (false
renders the finished transcript as a static panel — same look, no motion),
loop, speed, height, className.

A script is ScriptStep[]:
  cmd?: string          command typed at the prompt
  cwd?: string          prompt path shown
  out?: Array<string | { text: string; tone?: Tone }>
  spinner?: string      spinner label while "working"
  ms?: number           spinner duration
  done?: string         text when the spinner finishes
  cps?, enterPause?, lineMs?, after?   timing overrides

Tone is "plain" | "dim" | "ok" | "warn" | "err" | "accent" | "cyan".

Colors come from CSS custom properties (--term-bg, --term-fg, …) so it already
follows the app theme. Never restyle it with Tailwind utilities.

Don't render many on one page — each instance injects its own <style>.

### CopyCommand — a single-line shell command with a copy button

For one-liners the reader is meant to run. Renders a "$ " prefix and a copy
button with a toast. Use this instead of styling a <code> block by hand.

### Static multi-line code blocks

A bordered panel with a caption row and a copy button — see the Surfaces
section for the pattern. Use bg-muted/50 with a border, never a hardcoded dark
background.

If a design needs a terminal or code presentation, write
`<Terminal script={...} />` or `<CopyCommand command="..." />` as a placeholder
and describe the intended content. Do not invent a replacement.

### Files copied in from the source repo are READ-ONLY

Some real source files are provided in this workspace ONLY so imports resolve
and the preview renders — terminal.tsx, terminal-timeline.ts, use-in-view,
use-reduced-motion, and any component supplied later.

Never modify, refactor, "improve", regenerate, or reformat them. They carry
deliberate defensive behaviour that looks redundant out of context:

- useInView starts `true` on purpose — it fails OPEN, because starting `false`
  freezes consumers wherever IntersectionObserver never fires (iframes, jsdom,
  previews). It also guards `typeof IntersectionObserver === "undefined"`.
- useReducedMotion guards `!window.matchMedia` and uses optional chaining on
  addEventListener, because jsdom does not implement matchMedia.

Deleting a guard like these reintroduces a bug someone already fixed. If one of
these files looks wrong, SAY SO in your response instead of changing it.

Do not rename or restructure existing components either. An existing readable
component must not be replaced by a minified or flattened equivalent — a
289-line SVG on one 5,000-character line cannot be reviewed or edited.

## Marketing / landing sections

Match the existing section idiom:

<section id="<anchor>" className="scroll-mt-16 border-b">
  <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
    <div className="flex max-w-2xl flex-col gap-4">
      <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
      <p className="text-base leading-relaxed text-muted-foreground text-pretty">
    ...
  </div>
</section>

Static marketing sections must NOT include loading, error, or empty states, and
must never include a control that switches between them. Those belong to
data-driven dashboard UI only. A state switcher on a landing page is a
design-system demo, not a product feature.

## Content

Never invent product features, API routes, CLI commands, or tool names. If real
copy is not supplied in the prompt, use obviously generic placeholders
(YOUR_APP, your-app.example.com) rather than plausible-looking fiction —
invented specifics read as real and get shipped by mistake.

## Accessibility and responsiveness

- Every interactive target at least 44px on mobile
- Real semantics: role-based elements with accessible names, keyboard operable
- The page must never scroll horizontally. Wide content (code blocks, tables,
  tab lists) scrolls inside its own overflow-x-auto container
- Works at 320px, 768px, and 1280px
```
