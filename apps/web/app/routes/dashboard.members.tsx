import { redirect, useRouteLoaderData } from "react-router";
import { Building2, UserX } from "lucide-react";
import { hasRole, listPendingInvitations, resolveMembership, ROLES } from "@starter/auth";
import { EmptyState } from "@starter/ui/components/layout/empty-state";
import type { Route } from "./+types/dashboard.members";
import type { loader as dashboardLoader } from "./dashboard";
import { CreateOrganizationButton } from "~/components/organizations/create-organization-dialog";
import { MemberList, type MemberRow } from "~/components/organizations/member-list";
import { PendingInvitations } from "~/components/organizations/pending-invitations";
import {
  correctedPageUrl,
  offsetFor,
  PAGE_SIZE,
  pageCountFor,
  pageLink,
  pagerFor,
  readPage,
} from "~/lib/pagination";
import { requireUser } from "~/lib/require-user";

/** Each list carries its own page in the URL, so paging one leaves the other alone. */
const MEMBERS_PARAM = "members";
const INVITATIONS_PARAM = "invitations";

/**
 * Members of the active organization, plus the invitations that have not been
 * spent yet.
 *
 * Read-only by design: invite, resend, revoke, change-role, remove and leave
 * are #37. Nothing here mutates, so there is no action.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  // Its own guard, not the layout's. Children run in parallel with the layout
  // loader and single fetch can be asked for this one alone, so the parent's
  // redirect never applies (audit #10).
  const session = await requireUser(context, request);
  const url = new URL(request.url);

  /*
   * The organization comes from the session, or — when the session names none —
   * from the caller's own oldest membership, which is the row the sidebar
   * switcher already displays. Never from the URL: a page whose tenant is a
   * query parameter is a page that reads another tenant when someone edits it.
   *
   * The fallback is not the fix for a missing active organization;
   * `sessionDatabaseHooks` is. It is what keeps a session minted *before* that
   * hook shipped from being told it has no organizations.
   */
  const membership = await resolveMembership(context.db, {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  });

  if (!membership) {
    /*
     * Which empty state turns on whether they belong **anywhere**, not on
     * whether the session named something. Those come apart after a removal:
     * better-auth clears the *remover's* active organization and never the
     * removed member's, so someone thrown out of their only organization keeps
     * a session naming it. Keyed on the session field, that reads as
     * "not a member of this one" and offers a switcher with nothing in it —
     * and on a phone, where the sidebar is `hidden md:block`, no way to create
     * one either. Organization *deletion* does not show this, because the
     * foreign key nulls the session field and lands on the create card.
     *
     * A second lookup, used as a **boolean**. Deliberately not as a fallback
     * organization: the session named one, and quietly rendering a different
     * tenant's roster instead would be a worse answer than saying what
     * happened. It only runs on the miss path.
     */
    if (!session.session.activeOrganizationId) return { state: "none" as const };

    const belongsElsewhere = await resolveMembership(context.db, {
      userId: session.user.id,
      organizationId: null,
    });

    return { state: belongsElsewhere ? ("not-a-member" as const) : ("none" as const) };
  }

  const canReadInvitations = hasRole(membership.role, ROLES.admin);
  const membersPage = readPage(url.searchParams.get(MEMBERS_PARAM));
  const invitationsPage = readPage(url.searchParams.get(INVITATIONS_PARAM));

  /*
   * Better Auth's own list-members: it paginates (`limit`/`offset`/`sortBy`),
   * joins the user rows, and re-checks membership itself. `organizationId` is
   * passed rather than left to default, because the fallback above may have
   * resolved an organization the session does not name.
   *
   * Its sibling `list-invitations` is *not* used: its adapter runs a bare
   * `findMany` on `organizationId` with no limit and no status filter, so it
   * reads every spent invitation an organization has ever had. `org-store.ts`
   * exists for that reason.
   */
  const [members, invitations] = await Promise.all([
    context.auth.api.listMembers({
      headers: request.headers,
      query: {
        organizationId: membership.organizationId,
        limit: PAGE_SIZE,
        offset: offsetFor(membersPage),
        sortBy: "createdAt",
        sortDirection: "asc",
      },
    }),
    canReadInvitations
      ? listPendingInvitations(context.db, {
          userId: session.user.id,
          organizationId: membership.organizationId,
          limit: PAGE_SIZE,
          offset: offsetFor(invitationsPage),
        })
      : null,
  ]);

  // A page number past the end renders an empty list under a pager that claims
  // otherwise. Correct the URL instead, both lists in one redirect.
  const correction = correctedPageUrl(url, [
    { param: MEMBERS_PARAM, requested: membersPage, pageCount: pageCountFor(members.total) },
    ...(invitations
      ? [
          {
            param: INVITATIONS_PARAM,
            requested: invitationsPage,
            pageCount: pageCountFor(invitations.total),
          },
        ]
      : []),
  ]);
  if (correction) throw redirect(correction);

  const membersPager = pagerFor(membersPage, members.total);
  const invitationsPager = invitations ? pagerFor(invitationsPage, invitations.total) : null;

  return {
    state: "ready" as const,
    organizationId: membership.organizationId,
    members: {
      rows: members.members.map(
        (member): MemberRow => ({
          id: member.id,
          name: member.user.name,
          email: member.user.email,
          role: member.role,
          joinedAt: new Date(member.createdAt).toISOString(),
          isSelf: member.userId === session.user.id,
        }),
      ),
      pager: membersPager,
      previousUrl: membersPager.hasPrevious
        ? pageLink(url, MEMBERS_PARAM, membersPager.page - 1)
        : null,
      nextUrl: membersPager.hasNext ? pageLink(url, MEMBERS_PARAM, membersPager.page + 1) : null,
    },
    invitations:
      invitations && invitationsPager
        ? {
            rows: invitations.rows,
            pager: invitationsPager,
            previousUrl: invitationsPager.hasPrevious
              ? pageLink(url, INVITATIONS_PARAM, invitationsPager.page - 1)
              : null,
            nextUrl: invitationsPager.hasNext
              ? pageLink(url, INVITATIONS_PARAM, invitationsPager.page + 1)
              : null,
          }
        : null,
  };
}

function PageHeading({ organizationName }: { organizationName: string | null }) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Members</h1>
      <p className="text-muted-foreground">
        {organizationName
          ? `Who belongs to ${organizationName}, and who has been invited.`
          : "Who belongs to this organization, and who has been invited."}
      </p>
    </div>
  );
}

export default function MembersPage({ loaderData }: Route.ComponentProps) {
  /**
   * The organization's name comes from the parent, which already listed the
   * user's organizations for the switcher — querying it again here would bill
   * D1 twice for one answer. This route still guards itself in its own loader;
   * reading the parent's data is not what makes it safe.
   */
  const parent = useRouteLoaderData<typeof dashboardLoader>("routes/dashboard");

  // Destructured before the check on purpose: React Router's serialised loader
  // type is not a discriminated union, so `state` cannot narrow the payload.
  // The payload narrows itself, and the discriminant is left to say *why* there
  // is none.
  const { members, invitations, organizationId } = loaderData;

  if (!members) {
    return (
      <div className="space-y-6">
        <PageHeading organizationName={null} />
        {loaderData.state === "not-a-member" ? (
          /*
           * Reachable once #37 ships removal: Better Auth clears the
           * *remover's* active organization, never the removed member's, so
           * their session keeps naming an organization they can no longer read.
           * Saying so beats the first-run empty state, which would tell someone
           * with three other organizations that they have none.
           */
          /*
            The copy names no control. This state means the reader belongs to
            at least one *other* organization, and the way to reach one is the
            sidebar switcher — which is `hidden md:block`, so on a phone there
            is none to point at. Naming it would make the sentence false on
            exactly the device that cannot act on it.
          */
          <EmptyState
            icon={<UserX className="h-10 w-10" />}
            title="You are not a member of this organization"
            description="Your membership may have ended, or the organization may have been deleted. Switch to one of your other organizations to continue."
          />
        ) : (
          <EmptyState
            icon={<Building2 className="h-10 w-10" />}
            title="Create your first organization"
            description="Members and invitations belong to an organization. You will be its owner, and you can create more later."
            action={<CreateOrganizationButton className="w-auto" />}
          />
        )}
      </div>
    );
  }

  const organizationName =
    parent?.organizations.find((org) => org.id === organizationId)?.name ?? null;

  return (
    <div className="space-y-6">
      <PageHeading organizationName={organizationName} />

      <MemberList
        members={members.rows}
        pager={members.pager}
        previousUrl={members.previousUrl}
        nextUrl={members.nextUrl}
      />

      {/*
        Absent, not empty, for a plain member. The loader decides that with
        `hasRole` and simply does not read the rows, so there is nothing here to
        hide — see `pending-invitations.tsx`.
      */}
      {invitations && (
        <PendingInvitations
          invitations={invitations.rows}
          pager={invitations.pager}
          previousUrl={invitations.previousUrl}
          nextUrl={invitations.nextUrl}
        />
      )}
    </div>
  );
}
