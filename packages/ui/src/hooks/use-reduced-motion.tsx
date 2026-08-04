import * as React from "react";

/**
 * Tracks `prefers-reduced-motion`. Starts `false` on the server and syncs on
 * mount (SSR-safe init — same pattern as use-theme; a lazy initializer would
 * cause a hydration mismatch).
 */
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}
