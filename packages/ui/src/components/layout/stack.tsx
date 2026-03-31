import { cn } from "../../lib/utils";

interface StackProps {
  children: React.ReactNode;
  gap?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const gapMap = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
};

/** Vertical flex stack with configurable gap */
export function Stack({ children, gap = "md", className }: StackProps) {
  return <div className={cn("flex flex-col", gapMap[gap], className)}>{children}</div>;
}
