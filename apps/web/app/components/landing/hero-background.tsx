import { MeshGradient } from "@paper-design/shaders-react";
import { Component, useSyncExternalStore, type ReactNode } from "react";

import { useTheme } from "@starter/ui/hooks/use-theme";

import { HERO_SHADER, heroColors, heroSpeed, supportsWebGl2 } from "./hero-shader";
import "./hero-poster.css";

/** Probed once per page — the answer cannot change, and each probe costs a
 *  WebGL context from the browser's small per-page budget. */
let webGl2Support: boolean | undefined;
const getWebGl2Support = () => (webGl2Support ??= supportsWebGl2(document));

let reducedMotionQuery: MediaQueryList | undefined;
const getReducedMotionQuery = () =>
  (reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)"));

const neverChanges = () => () => {};
const getReducedMotion = () => getReducedMotionQuery().matches;

function subscribeReducedMotion(onChange: () => void) {
  const query = getReducedMotionQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Both signals are read with `useSyncExternalStore` rather than an effect: the
 * server snapshot is the conservative one (no shader, no motion), so the server
 * render and the hydration pass agree, and the real value lands on the first
 * post-hydration render without a `setState` cascade.
 */
const useCanRenderShader = () => useSyncExternalStore(neverChanges, getWebGl2Support, () => false);
const usePrefersReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);

/**
 * Catches a shader that fails after the capability probe passed — a driver that
 * refuses to compile the program, or a canvas that loses out on the browser's
 * per-page WebGL context budget. Without it those escape to the route's error
 * boundary and a decorative background takes down the whole landing page.
 */
class ShaderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Animated mesh-gradient wash behind the hero.
 *
 * Three layers, back to front:
 *
 * 1. A still of the shader's own frame 0. Always painted, so the server render
 *    and any browser without WebGL2 get the same composition rather than a
 *    blank band — the canvas only ever mounts on the client, and when it does
 *    it starts on the frame the still already shows.
 * 2. The shader itself, when the browser can run it.
 * 3. A scrim fading to `--background`, which both lifts text contrast over the
 *    orange (near-white body text on `#ff5e1f` is ~3:1 on its own) and joins
 *    the section to the one below without a visible seam.
 */
export function HeroBackground() {
  const { resolvedMode } = useTheme();
  const canRenderShader = useCanRenderShader();
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div
      // Role-less and aria-hidden by design, so the e2e guard has nothing else
      // to grab it by.
      data-testid="hero-background"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Frame 0 of the shader below, captured as a still. Which theme's poster
          shows is decided in CSS, never from `resolvedMode` — the theme resolves
          client-side, so a JS-driven choice renders the light one on the server
          and the dark one on the client, a hydration mismatch React will not
          patch up. */}
      <div className="hero-poster absolute inset-0" />

      {canRenderShader && (
        <ShaderBoundary>
          <MeshGradient
            colors={heroColors(resolvedMode)}
            {...HERO_SHADER}
            speed={heroSpeed(prefersReducedMotion)}
            /* This shader is very low-frequency, so rendering it below device
               pixel ratio is imperceptible and cuts fill rate ~4x on retina.
               The library's own floor is minPixelRatio 2. */
            minPixelRatio={1}
            maxPixelCount={1920 * 1080}
            className="absolute inset-0"
            style={{ width: "100%", height: "100%" }}
          />
        </ShaderBoundary>
      )}

      <div className="via-background/35 to-background absolute inset-0 bg-gradient-to-b from-transparent" />
    </div>
  );
}
