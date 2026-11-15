import { PRODUCT_NAME } from "@starter/config/product";
import { cn } from "@starter/ui/lib/utils";

import { BrandMark } from "./brand-mark";

const SIZES = {
  sm: {
    tile: "size-7 rounded-md",
    mark: "size-4",
    name: "text-sm font-semibold tracking-tight",
  },
  md: {
    tile: "size-8 rounded-lg",
    mark: "size-5",
    name: "text-base font-semibold tracking-tight sm:text-lg",
  },
  lg: {
    tile: "size-10 rounded-lg",
    mark: "size-6",
    name: "text-lg font-semibold tracking-tight",
  },
} as const;

/**
 * The logo lockup: the mark on its tile, then the product name.
 *
 * Product-owned: the starter ships this file once and does not edit it again.
 * It is the one place the lockup is decided; call sites pass a size and
 * whether the name shows, and build nothing themselves.
 *
 * With `showName={false}` the name stays in the accessibility tree. The mark
 * is `aria-hidden`, so a link around the mark alone would have no name.
 */
export function BrandLogo({
  size = "md",
  showName = true,
  className,
}: {
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}) {
  const classes = SIZES[size];

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className={cn("flex shrink-0 items-center justify-center bg-primary", classes.tile)}>
        <BrandMark className={cn(classes.mark, "text-primary-foreground")} />
      </span>
      <span className={showName ? classes.name : "sr-only"}>{PRODUCT_NAME}</span>
    </span>
  );
}
