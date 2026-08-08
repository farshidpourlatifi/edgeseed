import { Layers } from "lucide-react";

/**
 * The product mark.
 *
 * Currently lucide's `Layers`. Wrapping it rather than importing `Layers`
 * directly at each call site is the whole point: before this existed the
 * landing pages used `Cloud` while auth and the dashboard used `Layers`, so
 * the product had two logos and nobody noticed. Changing the mark is now one
 * edit here instead of seven scattered ones.
 *
 * It inherits `currentColor` and sizing from `className`, so call sites keep
 * setting `size-5` / `text-primary-foreground` exactly as they did.
 *
 * If this is ever replaced with custom artwork, update
 * `apps/web/public/favicon.svg` in the same change — a favicon has to be a
 * standalone fetchable file, so it cannot import this.
 */
export function BrandMark({ className }: { className?: string }) {
  return <Layers className={className} aria-hidden="true" />;
}
