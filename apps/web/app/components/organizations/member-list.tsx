import { UserPlus, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Avatar, AvatarFallback } from "@starter/ui/components/ui/avatar";
import { Badge } from "@starter/ui/components/ui/badge";
import { EmptyState } from "@starter/ui/components/layout/empty-state";
import { InviteMemberButton } from "./invite-member-dialog";
import { ListPager } from "./list-pager";
import { MemberActions } from "./member-actions";
import { RoleBadge } from "./role-badge";
import { formatDate } from "~/lib/format-date";
import type { Pager } from "~/lib/pagination";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  /** The viewer's own row, marked so a list of similar names is navigable. */
  isSelf: boolean;
  /**
   * The last owner standing — a fact about the organization rather than a
   * permission, which is why it rides on the row and not in `capabilities`.
   * Nothing may leave the organization without an owner, so this removes
   * "Remove" from the row and turns "Leave" into an explanation.
   */
  isLastOwner: boolean;
}

export interface MemberListProps {
  members: MemberRow[];
  pager: Pager;
  previousUrl: string | null;
  nextUrl: string | null;
  organizationId: string;
  /** Decided by the loader from `ORG_CAPABILITIES`; never re-derived here. */
  capabilities: {
    invite: boolean;
    changeRole: boolean;
    removeMember: boolean;
  };
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

export function MemberList({
  members,
  pager,
  previousUrl,
  nextUrl,
  organizationId,
  capabilities,
}: MemberListProps) {
  /**
   * A roster of one, which is what an organization looks like the moment it is
   * created. V0's Team tab called this "You're the only member of this
   * organization" and offered the first invitation from it; #36 left the
   * control out because it would have opened nothing (issue #16), and this is
   * where it comes back.
   *
   * `pager.total`, not `members.length` — page two of a 21-member organization
   * has one row on it and is not the same thing at all.
   */
  const isSoleMember = pager.total === 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Members</CardTitle>
          <CardDescription>Everyone with access to this organization.</CardDescription>
        </div>
        {capabilities.invite && !isSoleMember && (
          <InviteMemberButton organizationId={organizationId} variant="outline" />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {members.length === 0 ? (
          /*
           * Very nearly unreachable — the viewer is a member of the
           * organization being listed, so the list contains at least them.
           * It is here as the answer to a membership that ends between the
           * check and the read, not as a screen anyone is meant to arrive at.
           */
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title="No members to show"
            description="Your membership of this organization may have just ended."
          />
        ) : (
          // Labelled so the roster is addressable as a list rather than as
          // whatever markup happens to surround it — for a screen reader, and
          // for `members.spec.ts`, which counts its rows to prove the page is
          // bounded.
          <ul aria-label="Members" className="divide-y rounded-md border">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {member.name}
                      {member.isSelf && (
                        <Badge variant="outline" className="shrink-0">
                          You
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email} · joined {formatDate(member.joinedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoleBadge role={member.role} />
                  <MemberActions
                    member={member}
                    organizationId={organizationId}
                    canChangeRole={capabilities.changeRole}
                    canRemove={capabilities.removeMember}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/*
          The V0 Team-tab empty state, reached by a real organization rather
          than by an empty list: the roster is never empty, because the reader
          is in it. Absent for somebody who cannot invite — the prompt would
          describe an action they have no way to take.
        */}
        {isSoleMember && capabilities.invite && (
          <div className="flex flex-col items-center gap-4 rounded-md border border-dashed py-8 text-center">
            <UserPlus className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">You are the only member</p>
              <p className="text-sm text-muted-foreground">
                Invite somebody and they will show up here once they accept.
              </p>
            </div>
            <InviteMemberButton organizationId={organizationId}>
              Invite your first teammate
            </InviteMemberButton>
          </div>
        )}

        <ListPager pager={pager} previousUrl={previousUrl} nextUrl={nextUrl} label="members" />
      </CardContent>
    </Card>
  );
}
