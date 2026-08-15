import { useState } from "react";
import { useRevalidator } from "react-router";
import { LogOut, MoreHorizontal, ShieldCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ROLES } from "@starter/auth/roles";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@starter/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@starter/ui/components/ui/dropdown-menu";
import { Label } from "@starter/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@starter/ui/components/ui/select";
import { Spinner } from "@starter/ui/components/ui/spinner";
import type { MemberRow } from "./member-list";
import { authClient } from "~/lib/auth-client";
import { memberActionMessage } from "~/lib/member-action-errors";

/**
 * The actions on one member's row.
 *
 * **Every dialog here is a sibling of the menu, never a child of it.** Radix
 * unmounts `DropdownMenuContent` when the menu closes and would take a nested
 * dialog with it, leaving a menu item that opens nothing — the defect #54 fixed
 * for the create-organization dialog. `onSelect` sets state; the dialogs read
 * it, mounted next to the `DropdownMenu` rather than inside it.
 *
 * **What is absent versus what is disabled** is two different decisions, and
 * both are deliberate:
 *
 * - An admin does not see "Change role" or "Remove" *at all*. They are
 *   owner-only, and offering a greyed-out control tells somebody about a power
 *   they cannot have rather than about a state they can change.
 * - The last owner **does** see "Change role" and "Leave organization", both
 *   disabled, sharing one reason beneath them. They hold the capability; the
 *   organization's state is what blocks it, and it is a state they can fix — so
 *   the controls name the way out (issue #16 allows exactly this, and only
 *   this). The rule of thumb: **rank is omitted, state is explained.**
 *
 * If nothing is available the trigger is not rendered either. A menu button
 * that opens an empty menu is the same broken promise as a dead control.
 */

/**
 * "a member", "an admin", "an owner".
 *
 * A ternary on `admin` shipped "a owner" — the article belongs to the word, not
 * to a list of roles somebody has to remember to extend. Keyed on the first
 * letter so a downstream product's own role reads correctly without touching
 * this file; a vowel *letter* is not always a vowel *sound* ("a unit"), but no
 * role reaching this string is one, and the alternative is a pronunciation
 * dictionary for a toast.
 */
const article = (role: string) => (/^[aeiou]/i.test(role) ? "an" : "a");

/** Roles a change-role dialog may set. Unlike an invitation, this one includes owner. */
const ASSIGNABLE_ROLES = [
  { value: ROLES.member, label: "Member" },
  { value: ROLES.admin, label: "Admin" },
  /**
   * The promotion path, and the only one there is — nobody is *invited* as an
   * owner. It is also how the last owner escapes their own protection: make
   * somebody else an owner, and then leaving or demoting becomes possible.
   */
  { value: ROLES.owner, label: "Owner" },
] as const;

export interface MemberActionsProps {
  member: MemberRow;
  organizationId: string;
  /** From the loader's `capabilities` — never re-derived from a role here. */
  canChangeRole: boolean;
  canRemove: boolean;
}

export function MemberActions({
  member,
  organizationId,
  canChangeRole,
  canRemove,
}: MemberActionsProps) {
  const revalidator = useRevalidator();
  const [dialog, setDialog] = useState<"role" | "remove" | "leave" | null>(null);
  const [role, setRole] = useState<string>(member.role);
  const [isWorking, setIsWorking] = useState(false);

  /*
   * The last owner is offered both of the controls that concern them, and
   * neither of them works — they are **disabled with the reason**, not hidden.
   * Rank is what gets omitted; state is what gets explained, and this is state
   * they can change. Better Auth refuses both regardless
   * (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_*`), so this only decides whether the
   * reader learns why before clicking or after.
   *
   * "Change role" is deliberately not conditioned on `isLastOwner`: it is the
   * same control that **promotes somebody else** from their own row, which is
   * exactly the way out of this state, so hiding it here while showing it there
   * would teach the wrong thing about the one screen that can fix it.
   *
   * `isLastOwner` implies `isSelf` wherever these render — only an owner has
   * `canChangeRole`, and if the organization has one owner, that owner is the
   * reader. `showRemove` keeps both clauses anyway, because a stale
   * `ownerCount` should drop the control rather than offer a removal the server
   * will refuse.
   */
  const showChangeRole = canChangeRole;
  const showRemove = canRemove && !member.isSelf && !member.isLastOwner;
  const showLeave = member.isSelf;

  if (!showChangeRole && !showRemove && !showLeave) return null;

  /** One place where a rejected call becomes a sentence, for all three writes. */
  async function run(
    action: "changeRole" | "remove" | "leave",
    call: () => Promise<{ error?: { code?: string; status?: number } | null }>,
    onSuccess: () => void,
  ) {
    setIsWorking(true);
    try {
      const { error } = await call();
      if (error) {
        toast.error(memberActionMessage(action, error));
        return;
      }
      onSuccess();
    } finally {
      setIsWorking(false);
    }
  }

  async function handleChangeRole() {
    await run(
      "changeRole",
      () =>
        authClient.organization.updateMemberRole({
          memberId: member.id,
          role: role as "member" | "admin" | "owner",
          // Passed rather than defaulted: the loader may have resolved an
          // organization the session does not name, and the endpoint would
          // otherwise fall back to `session.activeOrganizationId`.
          organizationId,
        }),
      async () => {
        await revalidator.revalidate();
        setDialog(null);
        toast.success(`${member.name} is now ${article(role)} ${role}`);
      },
    );
  }

  async function handleRemove() {
    await run(
      "remove",
      () =>
        authClient.organization.removeMember({
          memberIdOrEmail: member.id,
          organizationId,
        }),
      async () => {
        await revalidator.revalidate();
        setDialog(null);
        toast.success(`${member.name} was removed`);
      },
    );
  }

  async function handleLeave() {
    await run(
      "leave",
      () => authClient.organization.leave({ organizationId }),
      () => {
        /*
         * A reload, not `revalidate()` — the same reasoning as
         * `switchOrganization` in `dashboard.tsx`. Leaving clears the session's
         * active organization server-side, so it changes which tenant *every*
         * loader on the page is about, not just this one's rows.
         */
        window.location.reload();
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={`Actions for ${member.name}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        {/*
          Widened deliberately. Left to size itself the menu takes its width
          from the longest *item*, and the last-owner note below is prose — it
          wrapped "Leave organization" onto two lines to make room for itself.
        */}
        <DropdownMenuContent align="end" className="w-64">
          {showChangeRole && (
            <DropdownMenuItem
              disabled={member.isLastOwner}
              onSelect={() => {
                setRole(member.role);
                setDialog("role");
              }}
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              Change role
            </DropdownMenuItem>
          )}

          {showRemove && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog("remove")}>
              <UserMinus className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove from organization
            </DropdownMenuItem>
          )}

          {showLeave && (
            /*
             * Disabled rather than absent, with the reason underneath. The
             * reader holds the capability — the organization's state is what
             * blocks it, and telling them how to change that state is the whole
             * point of not simply hiding this.
             */
            <DropdownMenuItem
              variant="destructive"
              disabled={member.isLastOwner}
              onSelect={() => setDialog("leave")}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Leave organization
            </DropdownMenuItem>
          )}

          {/*
            One reason for both disabled items above, because it is one rule.
            Written once rather than repeated per item so the two cannot drift
            into saying slightly different things about the same constraint.
          */}
          {member.isLastOwner && (showChangeRole || showLeave) && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              You are the only owner. Make somebody else an owner first.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Siblings of the menu, for the reason at the top of this file. */}

      <Dialog
        open={dialog === "role"}
        onOpenChange={(next) => !isWorking && setDialog(next ? "role" : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              What {member.isSelf ? "you" : member.name} can do in this organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={isWorking}>
              <SelectTrigger id="member-role" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {member.isSelf && role !== ROLES.owner && (
              <p className="text-sm text-muted-foreground" role="status">
                This gives up your own owner access. Another owner would have to give it back.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog(null)}
              disabled={isWorking}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleChangeRole}
              disabled={isWorking || role === member.role}
              className="min-h-[44px]"
            >
              {isWorking ? (
                <>
                  <Spinner className="mr-2" />
                  Saving...
                </>
              ) : (
                "Save role"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={dialog === "remove"}
        onOpenChange={(next) => !isWorking && setDialog(next ? "remove" : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this organization immediately. You can invite them again later,
              and they keep their account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking} className="min-h-[44px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // The dialog would otherwise close on click, taking the pending
                // state with it and reporting nothing if the call is refused.
                event.preventDefault();
                void handleRemove();
              }}
              disabled={isWorking}
              className="min-h-[44px]"
            >
              {isWorking ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === "leave"}
        onOpenChange={(next) => !isWorking && setDialog(next ? "leave" : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access to it immediately. Somebody still inside would have to invite you
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking} className="min-h-[44px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleLeave();
              }}
              disabled={isWorking}
              className="min-h-[44px]"
            >
              {isWorking ? "Leaving..." : "Leave organization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
