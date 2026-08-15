import { MailPlus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { EmptyState } from "@starter/ui/components/layout/empty-state";
import { InvitationActions } from "./invitation-actions";
import { InviteMemberButton } from "./invite-member-dialog";
import { ListPager } from "./list-pager";
import { RoleBadge } from "./role-badge";
import { formatDate } from "~/lib/format-date";
import type { Pager } from "~/lib/pagination";

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface PendingInvitationsProps {
  invitations: InvitationRow[];
  pager: Pager;
  previousUrl: string | null;
  nextUrl: string | null;
  organizationId: string;
  /** Decided by the loader from `ORG_CAPABILITIES`; never re-derived here. */
  capabilities: {
    invite: boolean;
    revokeInvitation: boolean;
  };
}

/**
 * Invitations sent but not yet spent.
 *
 * Rendered for admins and owners only — the caller makes that decision with
 * `can(role, "readInvitations")`, and a plain member is served no invitations
 * section at all rather than an empty one. The rows carry the invited
 * addresses, which are the one thing on this page that is not already visible
 * to everyone in the organization.
 *
 * The controls arrived with #37 and the empty state changed with them: it now
 * offers the invitation it used to describe, because there is finally something
 * behind the button (issue #16 cuts both ways — a control that works belongs
 * where the reader is already looking).
 */
export function PendingInvitations({
  invitations,
  pager,
  previousUrl,
  nextUrl,
  organizationId,
  capabilities,
}: PendingInvitationsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          Invitations that have been sent and not yet accepted. Visible to admins and owners.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {invitations.length === 0 ? (
          <EmptyState
            icon={<MailPlus className="h-10 w-10" />}
            title="No pending invitations"
            description="Invitations appear here until the person accepts them or the link expires."
            action={
              capabilities.invite ? (
                <InviteMemberButton organizationId={organizationId} />
              ) : undefined
            }
          />
        ) : (
          <ul aria-label="Pending invitations" className="divide-y rounded-md border">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invitation.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Invited {formatDate(invitation.createdAt)}
                    {invitation.expiresAt && ` · expires ${formatDate(invitation.expiresAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoleBadge role={invitation.role} />
                  <InvitationActions
                    invitation={invitation}
                    organizationId={organizationId}
                    canResend={capabilities.invite}
                    canRevoke={capabilities.revokeInvitation}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <ListPager pager={pager} previousUrl={previousUrl} nextUrl={nextUrl} label="invitations" />
      </CardContent>
    </Card>
  );
}
