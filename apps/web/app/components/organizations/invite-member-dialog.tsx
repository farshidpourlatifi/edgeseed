import { useState } from "react";
import { useRevalidator } from "react-router";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ROLES } from "@starter/auth/roles";
import { Button } from "@starter/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@starter/ui/components/ui/dialog";
import { Input } from "@starter/ui/components/ui/input";
import { Label } from "@starter/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@starter/ui/components/ui/select";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { authClient } from "~/lib/auth-client";
import { memberActionMessage } from "~/lib/member-action-errors";

/**
 * Inviting somebody into the active organization.
 *
 * Modelled on `create-organization-dialog.tsx`, and for the same reasons: the
 * call goes from the browser to Better Auth's own endpoint, so
 * `/organization/invite-member` passes through the rate limiter that a
 * server-side `auth.api.*` call would step around, and `revalidate()` is what
 * puts the new row on screen.
 *
 * **The role select offers two options, and that is a product rule rather than
 * a limit of the endpoint.** Nobody is invited as an owner: becoming one is a
 * promotion, so it happens to somebody already inside the organization, where
 * the last-owner protections can see it. Better Auth would let an *owner* hand
 * out `owner` here — the `beforeCreateInvitation` hook in
 * `packages/auth/src/organization.ts` is what actually refuses it, because a
 * select is a control and not a boundary.
 *
 * **It will 429, and that is the design working.** `/organization/invite-member`
 * sits in the strict `mail` class, so a few invitations in one sitting is all
 * it takes. The refusal is named rather than generic
 * (`member-action-errors.ts`) — the answer is to wait, never to loosen the
 * class.
 *
 * A failure to *send* cannot be reported at all: better-auth wraps
 * `sendInvitationEmail` in `runInBackgroundOrAwait` and swallows the rejection,
 * exactly as the password-reset path does (ADR 003). So the success toast means
 * the invitation exists, which is what the pending list then shows.
 */

/** The roles an invitation may carry. `owner` is deliberately absent — see above. */
const INVITABLE_ROLES = [
  { value: ROLES.member, label: "Member", hint: "Can see the organization's people." },
  { value: ROLES.admin, label: "Admin", hint: "Can also invite people and revoke invitations." },
] as const;

export function InviteMemberDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(ROLES.member);
  /**
   * The last refusal **and the address it was about**, so the message can be
   * derived rather than cleared by hand — the trap
   * `create-organization-dialog.tsx` documents having fallen into, where an
   * alert went on naming a value that was no longer being submitted.
   */
  const [failure, setFailure] = useState<{ email: string; message: string } | null>(null);
  const [isSending, setIsSending] = useState(false);

  const submitted = email.trim().toLowerCase();
  const canSubmit = submitted.length > 0;
  const error = failure?.email === submitted ? failure.message : null;

  function reset() {
    setEmail("");
    setRole(ROLES.member);
    setFailure(null);
  }

  function handleOpenChange(next: boolean) {
    if (isSending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || isSending) return;

    setIsSending(true);
    setFailure(null);
    try {
      /*
       * `organizationId` is passed rather than left to default. The loader may
       * have resolved an organization the session does not name — that fallback
       * is the whole reason `resolveMembership` takes a nullable id — and the
       * endpoint would otherwise read `session.activeOrganizationId` and invite
       * somebody into a different one than the page is showing.
       */
      const { error: inviteError } = await authClient.organization.inviteMember({
        email: submitted,
        role: role as "member" | "admin",
        organizationId,
      });

      if (inviteError) {
        setFailure({ email: submitted, message: memberActionMessage("invite", inviteError) });
        return;
      }

      await revalidator.revalidate();
      reset();
      onOpenChange(false);
      toast.success(`Invitation sent to ${submitted}`);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They will get an email with a link to join. It expires, and it can only be used once.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSending}
              maxLength={254}
              autoComplete="email"
              aria-describedby={error ? "invite-email-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="h-11"
            />
            {error && (
              <p id="invite-email-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={isSending}>
              <SelectTrigger id="invite-role" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {INVITABLE_ROLES.find((option) => option.value === role)?.hint} Only an owner can make
              somebody else an owner, once they have joined.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isSending} className="min-h-[44px]">
              {isSending ? (
                <>
                  <Spinner className="mr-2" />
                  Sending...
                </>
              ) : (
                "Send invitation"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A button that opens the invite dialog.
 *
 * Two surfaces render it: the members card header, and the "you are the only
 * one here" prompt beneath a one-person roster — the control #36 left out
 * because it would have opened nothing (issue #16).
 *
 * The dialog is a sibling of the button, never of a menu item. No menu opens
 * this one today, but keeping the shape means a caller cannot later mount it
 * inside `DropdownMenuContent`, which Radix unmounts on close (#54).
 */
export function InviteMemberButton({
  organizationId,
  variant = "default",
  children,
}: {
  organizationId: string;
  variant?: "default" | "outline";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className="min-h-[44px]">
        <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        {children ?? "Invite member"}
      </Button>
      <InviteMemberDialog organizationId={organizationId} open={open} onOpenChange={setOpen} />
    </>
  );
}
