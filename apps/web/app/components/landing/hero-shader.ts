/**
 * Pure model for the hero's shader background: which colours a resolved theme
 * gets, whether the animation may run, and whether the browser can render it at
 * all. No React, no side effects — fully unit- and mutation-testable.
 */

export type ResolvedMode = "dark" | "light";

/**
 * Cloudflare's accent orange, read off cloudflare.com's hero panel on
 * 2026-08-09: `--color-accent-100`, `rgb(255, 94, 31)`. Not the older logo
 * orange `#f38020`, which no longer appears in their stylesheets. Their site
 * uses this same value in both light and dark — only the page chrome flips —
 * so it is one constant here too.
 *
 * Deliberately *not* a design-system token: the hero is the one surface that
 * leans on Cloudflare's identity rather than the product's own blue
 * `--primary`, so pulling it from `app.css` would misstate where the colour
 * comes from, and would repaint the hero the moment a clone restyles its
 * primary.
 */
export const CF_ORANGE = "#ff5e1f";

const LIGHT_BASE = "#ffffff";
const DARK_BASE = "#000000";

/** Ambient rather than attention-seeking, but with visible movement. */
export const SHADER_SPEED = 0.75;

/** Orange against the theme's extreme: white in light mode, black in dark. */
export function heroColors(mode: ResolvedMode): [string, string] {
  return [CF_ORANGE, mode === "dark" ? DARK_BASE : LIGHT_BASE];
}

/**
 * Everything that decides what the shader draws, in one object.
 *
 * `fit: "cover"` over a fixed 16:9 world is what makes the poster idea work at
 * all: the composition is laid out in this world box and cover-cropped to the
 * canvas, so it does **not** depend on the viewport's aspect ratio. CSS
 * `background-size: cover` crops a 16:9 image by the same rule, so one captured
 * still lines up with the shader at every window size. With the library's
 * default sizing the shader would re-lay-out per aspect ratio and the poster
 * would only match at the size it was captured.
 */
export const HERO_SHADER = {
  distortion: 1,
  swirl: 0.2,
  rotation: 90,
  fit: "cover",
  worldWidth: 1600,
  worldHeight: 900,
} as const;

/**
 * The poster in `hero-poster.css` is a capture of this shader's frame 0, so it
 * goes stale the moment any of the above changes — silently, since a stale
 * poster still looks like *a* gradient. `hero-shader.test.ts` compares this
 * string against the live parameters and fails when they drift.
 *
 * Regenerating: see `docs/design-workflow.md` → "Hero poster".
 */
export const POSTER_FINGERPRINT =
  '{"colors":["#ff5e1f","#ffffff"],"distortion":1,"swirl":0.2,"rotation":90,"fit":"cover","worldWidth":1600,"worldHeight":900}';

/** The exact input the poster was captured from — light mode, frame 0. */
export function posterFingerprint(): string {
  return JSON.stringify({ colors: heroColors("light"), ...HERO_SHADER });
}

/**
 * `prefers-reduced-motion` pins the speed to zero, which freezes the shader on
 * a still frame rather than dropping the gradient. The library has no
 * reduced-motion handling of its own — nothing in either package references the
 * query — so this is the only thing standing between that preference and a
 * permanently animating hero.
 */
export function heroSpeed(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : SHADER_SPEED;
}

/**
 * Whether this browser can give us a WebGL2 context.
 *
 * The shader library requests `webgl2` and **throws from its constructor** when
 * the context is null, so the question has to be answered before mounting, not
 * recovered from after. The misses are not exotic: hardened privacy configs and
 * enterprise policies that disable WebGL, older low-end Android, and headless CI
 * browsers.
 *
 * The probe context is released immediately. Browsers cap live WebGL contexts
 * per page at a low number and evict the oldest, so a probe left holding one can
 * cost a real canvas elsewhere on the page.
 */
export function supportsWebGl2(doc: Pick<Document, "createElement">): boolean {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
