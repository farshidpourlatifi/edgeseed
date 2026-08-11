import { useState } from "react";
import { useRevalidator } from "react-router";
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
import { authClient } from "~/lib/auth-client";

/**
 * The name is the only editable field, and the email input is disabled on
 * purpose rather than as a placeholder: Better Auth's `/update-user` rejects an
 * `email` key outright (`EMAIL_CAN_NOT_BE_UPDATED`), because changing an
 * address has to re-run verification — the gate audit #2 rests on. An enabled
 * input would be a control with nowhere to go.
 */
export function ProfileForm({ user }: { user: { name: string; email: string } }) {
  const revalidator = useRevalidator();
  const [name, setName] = useState(user.name);
  const [isSaving, setIsSaving] = useState(false);

  const trimmed = name.trim();
  // Nothing to save is a disabled button, not a success toast for a no-op.
  const canSave = trimmed.length > 0 && trimmed !== user.name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setIsSaving(true);
    try {
      const { error } = await authClient.updateUser({ name: trimmed });
      if (error) {
        toast.error(error.message ?? "Could not save your profile");
        return;
      }

      // The sidebar and topbar read the name from the dashboard *layout*
      // loader, so the write is invisible until every loader re-runs. Awaiting
      // it also means the success toast only fires once the new name is the
      // one on screen.
      await revalidator.revalidate();
      toast.success("Profile saved");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update the name shown across the app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSaving}
                maxLength={100}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                aria-describedby="email-help"
                className="h-11"
              />
              <p id="email-help" className="text-xs text-muted-foreground">
                Changing your email is not supported yet — the address identifies your account and
                would have to be verified again.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" className="min-h-[44px]" disabled={isSaving || !canSave}>
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
  );
}
