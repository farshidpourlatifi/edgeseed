import { Users } from "lucide-react";
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
import { ListPager } from "./list-pager";
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
}

export interface MemberListProps {
  members: MemberRow[];
  pager: Pager;
  previousUrl: string | null;
  nextUrl: string | null;
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

export function MemberList({ members, pager, previousUrl, nextUrl }: MemberListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Everyone with access to this organization.</CardDescription>
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
                <RoleBadge role={member.role} />
              </li>
            ))}
          </ul>
        )}

        <ListPager pager={pager} previousUrl={previousUrl} nextUrl={nextUrl} label="members" />
      </CardContent>
    </Card>
  );
}
