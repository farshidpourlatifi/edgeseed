import { useState } from "react";
import { useRevalidator } from "react-router";
import { MailX, MoreHorizontal, Send } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@starter/ui/components/ui/alert-dialog";
import { Button } from "@starter/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@starter/ui/components/ui/dropdown-menu";
import type { InvitationRow } from "./pending-invitations";
import { authClient } from "~/lib/auth-client";
import { memberActionMessage } from "~/lib/member-action-errors";

/**
 * Resend and revoke, on one pending invitation.
 *
 * **Resend is the same endpoint as invite**, with `resend: true` — it is not a
 * second path and it mints nothing. Better Auth reuses the invitation row,
 * updates `expiresAt` and hands the *same id* back to `sendInvitationEmail`, so
 * the message that goes out carries the link that was already sent
 * (`plugins/organization/routes/crud-invites.mjs`). Two consequences worth
 * knowing before changing anything here: a second token is never created, so an
 * invitee holding the first mail is not stranded by the second; and because it
 * is the same endpoint, a resend spends the strict `mail` budget exactly as an
 * invitation does. A few clicks in one minute is a 429, and the message says so
 * rather than reading as a failure.
 *
 * The role is deliberately not re-chosen here. Resending is "that mail may have
 * been lost", not "let me reconsider" — and better-auth carries the stored role
 * through regardless, so a select would be a control that changed nothing.
 *
 * The dialogs are siblings of the menu, never children of it (#54).
 */

export interface InvitationActionsProps {
  invitation: InvitationRow;
  organizationId: string;
  /**
   * From the loader's `capabilities`, which is the only place the matrix is
   * read. **Two props, not one**: resending is `invite` and withdrawing is
   * `revokeInvitation`, and they are the same level today only because
   * `ORG_CAPABILITIES` says so. Gating both on one of them would make this
   * component quietly wrong the first time that stops being true.
   */
  canResend: boolean;
  canRevoke: boolean;
}

export function InvitationActions({
  invitation,
  organizationId,
  canResend,
  canRevoke,
}: InvitationActionsProps) {
  const revalidator = useRevalidator();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  // No menu at all rather than a trigger that opens an empty one.
  if (!canResend && !canRevoke) return null;

  async function handleResend() {
    setIsWorking(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email: invitation.email,
        role: invitation.role as "member" | "admin",
        organizationId,
        resend: true,
      });

      if (error) {
        toast.error(memberActionMessage("resend", error));
        return;
      }

      // The expiry moved, and it is rendered on this row — so the list has to
      // re-read rather than keep showing the old date.
      await revalidator.revalidate();
      toast.success(`Invitation resent to ${invitation.email}`);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRevoke() {
    setIsWorking(true);
    try {
      const { error } = await authClient.organization.cancelInvitation({
        invitationId: invitation.id,
      });

      if (error) {
        toast.error(memberActionMessage("revoke", error));
        return;
      }

      await revalidator.revalidate();
      setConfirmingRevoke(false);
      toast.success(`Invitation to ${invitation.email} revoked`);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={`Actions for the invitation to ${invitation.email}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canResend && (
            <DropdownMenuItem disabled={isWorking} onSelect={() => void handleResend()}>
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              Resend invitation
            </DropdownMenuItem>
          )}
          {canRevoke && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingRevoke(true)}>
              <MailX className="mr-2 h-4 w-4" aria-hidden="true" />
              Revoke invitation
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmingRevoke}
        onOpenChange={(next) => !isWorking && setConfirmingRevoke(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The link sent to {invitation.email} stops working. You can invite them again
              afterwards, which sends a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking} className="min-h-[44px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Without this the dialog closes on click and a refusal would
                // have nowhere to be reported.
                event.preventDefault();
                void handleRevoke();
              }}
              disabled={isWorking}
              className="min-h-[44px]"
            >
              {isWorking ? "Revoking..." : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
