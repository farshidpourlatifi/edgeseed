import * as React from "react";
import { cn } from "../../lib/utils";

interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * VisuallyHidden component - hides content visually but keeps it accessible to screen readers.
 * Use this for providing additional context to assistive technologies.
 */
function VisuallyHidden({ className, children, ...props }: VisuallyHiddenProps) {
  return (
    <span className={cn("sr-only", className)} {...props}>
      {children}
    </span>
  );
}

export { VisuallyHidden };
