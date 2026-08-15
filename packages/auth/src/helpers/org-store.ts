import { and, asc, count, desc, eq, exists, gt } from "drizzle-orm";
import { invitation, member, type Database } from "@starter/db";

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
