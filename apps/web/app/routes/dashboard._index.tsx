import type { Route } from "./+types/dashboard._index";

export async function loader({ context }: Route.LoaderArgs) {
  return { message: "Welcome to your dashboard" };
}

export default function DashboardIndex({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h2 className="text-2xl font-bold">{loaderData.message}</h2>
      <p className="mt-2 text-muted-foreground">
        Start building your product by adding routes and features.
      </p>
    </div>
  );
}
