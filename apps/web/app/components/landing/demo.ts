/**
 * The walkthrough film the landing page shows, or `null` for none.
 *
 * Extracted from the component so the **unset** branch is testable at all — the
 * state every clone is in once `init:product` clears `PRODUCT_DEMO_VIDEO`. An
 * e2e run can only exercise the film this checkout happens to declare; the
 * branch that matters for a clone is the one where nothing is declared. Same
 * reason `repo.ts` sits beside its component (issue #32).
 *
 * `null` is deliberately the shape for "no film" rather than an empty string: a
 * caller cannot render `null` as a `<source src>` or `poster` by accident, so
 * every consumer is forced to decide what it looks like without one — here, to
 * render nothing.
 */
import { PRODUCT_DEMO_VIDEO } from "@starter/config/product";

export type DemoVideo = {
  /** Path to the MP4 under `public/`. */
  src: string;
  /** Its poster still — the same basename with a `-poster.webp` suffix. */
  poster: string;
};

/**
 * The film for a given source path, or `null` for none.
 *
 * The poster is derived rather than a second constant so a clone that drops in
 * its own film names one pair of files (`/x.mp4` + `/x-poster.webp`) and sets a
 * single value. The source is a controlled config path, always with an
 * extension, so the swap is total.
 */
export function demoVideo(src: string): DemoVideo | null {
  if (!src) return null;
  return { src, poster: src.replace(/\.[^./]+$/, "-poster.webp") };
}

/** The film this build declares, or `null`. */
export const DEMO_VIDEO = demoVideo(PRODUCT_DEMO_VIDEO);
