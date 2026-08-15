import { and, asc, count, desc, eq, exists, gt } from "drizzle-orm";
import { invitation, member, type Database } from "@starter/db";
import { ROLES } from "./roles";

/** The row a page needs to know *which* organization it is looking at, and as whom. */
export interface Membership {
  organizationId: string;
  /** Compare with `hasRole`, never inline — see `helpers/roles.ts`. */
  role: string;
}

/** Safe-to-display view of an invitation that has not been spent yet. */
export interface PendingInvitationSummary {
  id: string;
  email: string;
  role: string;
  expiresAt: string | null;
  createdAt: string;
}

/** One page of rows plus the unfiltered total, so a caller can size its pager. */
export interface Page<T> {
  rows: T[];
  total: number;
}

/**
 * The organization a request acts in, resolved from the caller's own
 * memberships.
 *
 * Called with `organizationId` it answers "is this person a member of *that*
 * organization, and as what" — `null` meaning no. Called with `null` it falls
 * back to their oldest membership, which is the same row Better Auth's
 * `listOrganizations` returns first and therefore the organization the sidebar
 * switcher already displays.
 *
 * That fallback exists because `session.activeOrganizationId` is not always
 * set: Better Auth 1.6.26 writes it in create-organization, accept-invitation
 * and set-active only (`plugins/organization/routes/*.mjs`), so a session
 * minted before `activeOrganizationSessionField` shipped — or by any future
 * path that forgets — carries `null` while the user plainly has organizations.
 * Answering "create your first organization" to someone with three would be a
 * lie the UI cannot recover from.
 *
 * **This is a lookup, not the guard.** Everything it returns is derived from
 * `member` rows owned by `userId`, so it can never name an organization the
 * caller is not in; but a reader still scopes its own query, because a
 * membership can end between this call and that one.
 */
export async function resolveMembership(
  db: Database,
  input: { userId: string; organizationId: string | null },
): Promise<Membership | null> {
  const rows = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, input.userId),
        ...(input.organizationId ? [eq(member.organizationId, input.organizationId)] : []),
      ),
    )
    .orderBy(asc(member.createdAt), asc(member.id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * How many owners an organization has.
 *
 * The members page renders one page of at most `PAGE_SIZE` rows, so it cannot
 * count owners from what it is showing — the second owner may be on page three.
 * And the answer changes three controls at once: whether the sole owner's
 * "Leave" is offered or explained, whether their own role select can move off
 * `owner`, and whether "Remove" appears on an owner's row at all.
 *
 * Deliberately a `count()` rather than a filtered `listMembers`, which would
 * read whole rows — and deliberately **not** scoped by the caller's membership,
 * unlike `listPendingInvitations`. The caller has already resolved that
 * membership to get the id it passes, so a second check would be theatre; and
 * the number is derived from the same `role` column the page renders beside
 * every name, so there is nothing here to leak.
 *
 * Better Auth enforces the last-owner rule itself on every write
 * (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`). This is what lets
 * the page *say so first* instead of offering a control that fails.
 *
 * **An exact match, because this product writes exactly one role per member.**
 * Better Auth's `role` column can hold a comma-separated list, and its own
 * last-owner check reads it as `role.split(",").includes("owner")` — but
 * nothing here ever writes one: `creatorRole` is a single value, the invitation
 * form offers one role, and the role change sends one. A downstream product
 * that starts assigning multiple roles has to widen this, and the symptom would
 * be a second owner going uncounted — telling the first they are the only one,
 * which disables a control rather than opening anything.
 */
export async function countOwners(
  db: Database,
  input: { organizationId: string },
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.role, ROLES.owner)));

  return rows[0]?.value ?? 0;
}

/**
 * Pending invitations for one organization, bounded, newest first.
 *
 * Better Auth's `/organization/list-invitations` cannot be used for this: its
 * adapter runs a bare `findMany` on `organizationId` with no limit and no
 * status filter (`plugins/organization/adapter.mjs`), so it reads every
 * accepted, rejected and cancelled row an organization has ever had. D1 bills
 * rows scanned, and that number only grows.
 *
 * **`status = 'pending'` is not enough on its own.** Nothing expires an
 * invitation: better-auth never flips the column, it re-checks
 * `invitation.expiresAt < new Date()` on every accept and refuses there
 * (`crud-invites.mjs`). So a row stays `pending` forever, and a list filtered
 * on status alone shows links that cannot be accepted and pages a growing tail
 * of them. The `expiresAt > now` clause is what makes "pending" mean what the
 * screen says it means. A **null** `expiresAt` is excluded with them, and
 * deliberately: SQL drops it from the comparison, which is the same answer
 * better-auth reaches, since `null < new Date()` coerces to `0 < now` and
 * refuses.
 *
 * The `exists` clause is the **guard**, not decoration. A session's
 * `activeOrganizationId` is not proof of membership: `removeMember` nulls the
 * session of the person doing the removing only when they remove *themselves*
 * (`plugins/organization/routes/crud-members.mjs`), so someone else's removal
 * leaves the removed user holding a session that still names the organization.
 * Scoping the read by the caller's membership — rather than by the id they
 * arrived with — is what makes that stale value read nothing instead of a
 * tenant's invitee list.
 */
export async function listPendingInvitations(
  db: Database,
  input: {
    userId: string;
    organizationId: string;
    limit: number;
    offset: number;
    /** Injected so "expired" is a value a test can choose, not the wall clock. */
    now?: Date;
  },
): Promise<Page<PendingInvitationSummary>> {
  const scope = and(
    eq(invitation.organizationId, input.organizationId),
    eq(invitation.status, "pending"),
    gt(invitation.expiresAt, input.now ?? new Date()),
    exists(
      db
        .select({ one: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)),
        ),
    ),
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      })
      .from(invitation)
      .where(scope)
      .orderBy(desc(invitation.createdAt), asc(invitation.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(invitation).where(scope),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total: totals[0]?.value ?? 0,
  };
}
