import { useRouteLoaderData } from "react-router";
import { Building2 } from "lucide-react";
import { EmptyState } from "@starter/ui/components/layout/empty-state";
import type { Route } from "./+types/dashboard._index";
import type { loader as dashboardLoader } from "./dashboard";
import { BrandMark } from "~/components/brand/brand-mark";
import { CreateOrganizationButton } from "~/components/organizations/create-organization-dialog";
import { requireUser } from "~/lib/require-user";

// Guards even though it returns nothing: the layout loader is not a security
// boundary in React Router v7, and the next person to add data here would
// inherit an unguarded loader (audit #10).
export async function loader({ context, request }: Route.LoaderArgs) {
  await requireUser(context, request);
  return {};
}

export default function DashboardIndex() {
  /**
   * Read through the parent rather than querying again — the dashboard layout
   * loader already lists the user's organizations for the switcher, and a
   * second `listOrganizations` here would bill D1 twice for one answer. This
   * route still guards itself above; reading the parent's data is not what
   * makes it safe.
   */
  const parent = useRouteLoaderData<typeof dashboardLoader>("routes/dashboard");
  const organizations = parent?.organizations ?? [];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-20 text-center">
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

      {/*
        Additive, not a replacement. The welcome block is the dashboard's own
        identity and every signed-in account sees it — swapping it out on first
        run would make "am I actually on the dashboard?" unanswerable, which is
        the question `auth.spec.ts` and `password-reset.spec.ts` ask of this
        page after signing in.

        This is the first-run path — the one that says what to do rather than
        merely offering a control to find. The sidebar carries the same action
        for any dashboard page, and the topbar menu carries it on a phone, where
        that sidebar is `hidden md:block` (#54).
      */}
      {organizations.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Create your first organization"
          description="Organizations own members and data. You will be its owner, and you can create more later."
          action={<CreateOrganizationButton className="w-auto" />}
          className="w-full max-w-md"
        />
      )}
    </div>
  );
}
