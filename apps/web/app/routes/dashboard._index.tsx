/**
 * The starter's default dashboard home: the module `DASHBOARD_HOME_ROUTE`
 * (`app/product/dashboard.ts`) names until a product points it elsewhere.
 *
 * It must still typecheck when it is not mounted, and a module outside the
 * route config gets no generated route types, so it never imports `./+types`.
 */
import type { AppLoadContext, LoaderFunctionArgs } from "react-router";
import { BrandMark } from "~/components/brand/brand-mark";
import { requireUser } from "~/lib/require-user";

// Guards even though it returns nothing: the layout loader is not a security
// boundary in React Router v7, and the next person to add data here would
// inherit an unguarded loader (audit #10).
export async function loader({ context, request }: LoaderFunctionArgs<AppLoadContext>) {
  await requireUser(context, request);
  return {};
}

export default function DashboardIndex() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 pt-20 text-center">
      <div className="flex flex-col items-center gap-4">
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
    </div>
  );
}
