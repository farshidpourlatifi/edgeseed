import { cn } from "../../lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

/** Standard page container with max-width and padding */
export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn("mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}>{children}</div>
  );
}
