import type { Route } from "./+types/dashboard.settings";
import { listApiTokens } from "@starter/auth";
import { ApiTokens } from "~/components/settings/api-tokens";
import { ProfileForm } from "~/components/settings/profile-form";
import { requireUser } from "~/lib/require-user";

export async function loader({ context, request }: Route.LoaderArgs) {
  // Redirects rather than returning empty data. This loader reads API tokens,
  // so an unauthenticated caller must be turned away, not handed a 200 with
  // nothing in it (audit #10).
  const session = await requireUser(context, request);

  return {
    user: session.user,
    tokens: await listApiTokens(context.db, session.user.id),
  };
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { user, tokens } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings.</p>
      </div>

      <ProfileForm user={user} />

      <ApiTokens tokens={tokens} />
    </div>
  );
}
