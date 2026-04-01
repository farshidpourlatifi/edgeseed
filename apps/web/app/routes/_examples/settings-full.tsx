/**
 * Example: Full settings page with General/Team/Billing tabs.
 *
 * To use: copy to app/routes/dashboard.settings.tsx
 * Wire the save handler to auth.api.updateUser and team data to real org members.
 */
import { useState } from "react";
import type { Route } from "../+types/dashboard.settings";
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
import { Badge } from "@starter/ui/components/ui/badge";
import { Separator } from "@starter/ui/components/ui/separator";
import { Avatar, AvatarFallback } from "@starter/ui/components/ui/avatar";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { Upload, Trash2, Users, UserPlus } from "lucide-react";
import { toast } from "sonner";

export async function loader({ context, request }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) return { user: null };
  return { user: session.user };
}

export default function SettingsFullPage({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "team" | "billing">("general");

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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
        <p className="text-muted-foreground">Manage your account settings and preferences.</p>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("general")}
          className={`min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors ${
            activeTab === "general"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          General
        </button>
        <button
          onClick={() => setActiveTab("team")}
          className={`min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors ${
            activeTab === "team"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Team
        </button>
        <button
          onClick={() => setActiveTab("billing")}
          className={`flex min-h-[44px] items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors ${
            activeTab === "billing"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Billing
          <Badge variant="secondary" className="text-xs">
            Coming Soon
          </Badge>
        </button>
      </div>

      {/* General tab */}
      {activeTab === "general" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Update your personal information and profile picture.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  <Avatar className="h-20 w-20">
                    <AvatarFallback className="bg-primary/10 text-2xl text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="space-y-2">
                    <Button type="button" variant="outline" size="sm" className="min-h-[44px]">
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Photo
                    </Button>
                    <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max size 2MB.</p>
                  </div>
                </div>

                <Separator />

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

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>Irreversible and destructive actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Delete Account</p>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete your account and all associated data.
                  </p>
                </div>
                <Button variant="destructive" className="min-h-[44px]">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Team tab */}
      {activeTab === "team" && (
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>Manage your team members and their roles.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <Users className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No team members yet</p>
                <p className="text-sm text-muted-foreground">
                  You&apos;re the only member of this organization.
                </p>
              </div>
              <Button className="mt-2 min-h-[44px]">
                <UserPlus className="mr-2 h-4 w-4" />
                Invite your first teammate
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Billing tab */}
      {activeTab === "billing" && (
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>Manage your subscription and payment methods.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-[200px] items-center justify-center">
            <div className="text-center">
              <Badge variant="secondary" className="mb-4">
                Coming Soon
              </Badge>
              <p className="text-muted-foreground">Billing features will be available soon.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
