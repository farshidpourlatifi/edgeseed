import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/dashboard";
import { authClient } from "~/lib/auth-client";

export async function loader({ context, request }: Route.LoaderArgs) {
  if (!context.auth) {
    throw redirect("/login");
  }
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    throw redirect("/login");
  }
  return { user: session.user };
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <h1 className="text-lg font-semibold">Starter</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
