import * as React from "react";

/**
 * Is the element on screen? Fails OPEN: assumes visible until an observer
 * says otherwise — starting from `false` would freeze consumers in sandboxes
 * where IntersectionObserver never fires (some iframes, jsdom, previews).
 */
export function useInView(ref: React.RefObject<Element | null>) {
  const [inView, setInView] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}
