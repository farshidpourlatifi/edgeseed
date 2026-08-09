import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  CF_ORANGE,
  HERO_SHADER,
  POSTER_FINGERPRINT,
  SHADER_SPEED,
  heroColors,
  heroSpeed,
  posterFingerprint,
  supportsWebGl2,
} from "../components/landing/hero-shader";

describe("heroColors", () => {
  it("pairs the accent with white in light mode", () => {
    expect(heroColors("light")).toEqual([CF_ORANGE, "#ffffff"]);
  });

  it("pairs the accent with black in dark mode", () => {
    expect(heroColors("dark")).toEqual([CF_ORANGE, "#000000"]);
  });

  it("keeps the accent first in both modes, since the shader reads colors in order", () => {
    expect(heroColors("light")[0]).toBe(heroColors("dark")[0]);
  });
});

describe("heroSpeed", () => {
  it("animates by default", () => {
    expect(heroSpeed(false)).toBe(SHADER_SPEED);
  });

  it("freezes when reduced motion is preferred", () => {
    expect(heroSpeed(true)).toBe(0);
  });

  it("never animates faster than the ambient speed", () => {
    expect(SHADER_SPEED).toBeGreaterThan(0);
    expect(SHADER_SPEED).toBeLessThan(1);
  });
});

/**
 * The poster in `hero-poster.css` is a still of the shader's frame 0, so it goes
 * stale whenever a parameter changes — and stale is invisible, because a stale
 * poster is still a plausible-looking gradient. These are the regression guard:
 * they fail on drift and name the fix.
 *
 * They cannot compare pixels. Rendering the shader needs WebGL2, which neither
 * vitest nor Playwright's headless Chromium provides (see `tests/e2e/CLAUDE.md`),
 * so the parameters are the only thing CI can check. Verifying the image itself
 * is a manual step — `docs/design-workflow.md` → "Hero poster".
 */
describe("poster fingerprint", () => {
  it("matches the parameters the committed poster was captured from", () => {
    expect(posterFingerprint()).toBe(POSTER_FINGERPRINT);
  });

  it("covers every parameter that changes what the shader draws", () => {
    // A knob missing here is a knob that can drift without failing the test.
    expect(Object.keys(JSON.parse(POSTER_FINGERPRINT)).sort()).toEqual(
      ["colors", ...Object.keys(HERO_SHADER)].sort(),
    );
  });

  it("keeps the shader on a fixed 16:9 world, which is what makes one poster fit every viewport", () => {
    // `background-size: cover` on a 16:9 still only tracks the shader while the
    // shader itself is cover-cropping a 16:9 world.
    expect(HERO_SHADER.fit).toBe("cover");
    expect(HERO_SHADER.worldWidth / HERO_SHADER.worldHeight).toBeCloseTo(16 / 9, 5);
  });

  it("ships a poster for both themes", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../components/landing/hero-poster.css", import.meta.url)),
      "utf8",
    );
    const posters = css.match(/url\("data:image\/webp;base64,/g) ?? [];
    expect(posters).toHaveLength(2);
    expect(css).toContain(".dark .hero-poster");
    // Cover + centre is the half of the match CSS is responsible for.
    expect(css).toContain("background-size: cover");
    expect(css).toContain("background-position: center");
  });

  it("paints the accent under the poster, so a slow decode flashes orange not white", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../components/landing/hero-poster.css", import.meta.url)),
      "utf8",
    );
    expect(css).toContain(`background-color: ${CF_ORANGE}`);
  });
});

/** Minimal `document` stand-in: the probe only ever calls `createElement`. */
function fakeDocument(getContext: () => unknown) {
  return { createElement: () => ({ getContext }) } as unknown as Document;
}

describe("supportsWebGl2", () => {
  it("reports support when a context is returned", () => {
    const loseContext = vi.fn();
    expect(supportsWebGl2(fakeDocument(() => ({ getExtension: () => ({ loseContext }) })))).toBe(
      true,
    );
  });

  it("releases the probe context so it does not occupy the per-page budget", () => {
    const loseContext = vi.fn();
    supportsWebGl2(fakeDocument(() => ({ getExtension: () => ({ loseContext }) })));
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("tolerates a browser without WEBGL_lose_context", () => {
    expect(supportsWebGl2(fakeDocument(() => ({ getExtension: () => null })))).toBe(true);
  });

  // Deny paths: the shader library throws from its constructor on a null
  // context, so a false here is the only thing keeping the page alive.
  it("reports no support when the context is null", () => {
    expect(supportsWebGl2(fakeDocument(() => null))).toBe(false);
  });

  it("reports no support when getContext throws", () => {
    expect(
      supportsWebGl2(
        fakeDocument(() => {
          throw new Error("WebGL is disabled by policy");
        }),
      ),
    ).toBe(false);
  });

  it("reports no support when createElement itself throws", () => {
    const hostile = {
      createElement: () => {
        throw new Error("no DOM");
      },
    } as unknown as Document;
    expect(supportsWebGl2(hostile)).toBe(false);
  });
});
