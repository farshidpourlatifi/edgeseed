import { useState } from "react";
import type { Route } from "./+types/dashboard.settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Button } from "@starter/ui/components/ui/button";
import { Input } from "@starter/ui/components/ui/input";
import { Label } from "@starter/ui/components/ui/label";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { toast } from "sonner";

export async function loader({ context, request }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) return { user: null };
  return { user: session.user };
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    // TODO: wire to auth.api.updateUser
    await new Promise((resolve) => setTimeout(resolve, 800));
    setIsSaving(false);
    toast.success("Settings saved successfully");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update your name and email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSaving}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSaving}
                  className="h-11"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" className="min-h-[44px]" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
