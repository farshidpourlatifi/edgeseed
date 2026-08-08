import type { Route } from "./+types/dashboard._index";
import { BrandMark } from "~/components/brand/brand-mark";

export async function loader({ context: _context }: Route.LoaderArgs) {
  return {};
}

export default function DashboardIndex() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <BrandMark className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Welcome to your dashboard</h1>
      <p className="max-w-md text-muted-foreground">
        Start building your product by adding routes, queries, and features. Check{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">app/routes/_examples/</code> for
        reference implementations.
      </p>
    </div>
  );
}
