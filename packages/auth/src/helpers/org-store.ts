import { and, asc, count, desc, eq, exists, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { invitation, member, organization, user, type Database } from "@starter/db";
import { ROLES } from "./roles";

/** The row a page needs to know *which* organization it is looking at, and as whom. */
export interface Membership {
  organizationId: string;
  /** Compare with `hasRole`, never inline — see `helpers/roles.ts`. */
  role: string;
}

/** Safe-to-display view of an organization. */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
}

/** One member of an organization, with the person behind the membership row. */
export interface OrganizationMemberSummary {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

/** Just enough of a membership row to decide what a write may do to it. */
export interface MemberRef {
  id: string;
  userId: string;
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
 * "…and the caller belongs to that organization", as a clause rather than a
 * second round trip.
 *
 * Every read below scopes itself with this, because an organization id arriving
 * on a request is not proof of anything. `session.activeOrganizationId` survives
 * a removal — `removeMember` nulls the session of the person doing the removing,
 * and only when they remove *themselves*
 * (`plugins/organization/routes/crud-members.mjs`) — and an API token carries an
 * `organizationId` stamped when it was minted, which nothing revisits when its
 * owner is thrown out. Both are stale values a caller can still present.
 *
 * Deliberately in the same query rather than a preceding `resolveMembership`
 * call: the route does that too, but to learn the caller's *role*, and a guard
 * that lives one layer up is not a guard (AGENTS.md, "Guard where the data is
 * read"). The subquery is an indexed lookup on `member(organizationId)`.
 *
 * **The alias is load-bearing**, not tidiness: `listOrganizationMembers` selects
 * from `member` and would otherwise join the subquery's `member` to its own,
 * turning the guard into a tautology.
 */
function callerIsMember(db: Database, input: { userId: string; organizationId: string }) {
  const viewer = alias(member, "viewer");

  return exists(
    db
      .select({ one: viewer.id })
      .from(viewer)
      .where(and(eq(viewer.organizationId, input.organizationId), eq(viewer.userId, input.userId))),
  );
}

/**
 * What "pending" means for an invitation, in one place.
 *
 * Shared by the list and by the single-row lookup the revoke route resolves
 * through, so that `GET` → `DELETE` is a closed loop: an id the list will never
 * show is an id the write answers 404 for, rather than one that quietly
 * succeeds against a spent row.
 */
function pendingIn(organizationId: string, now?: Date) {
  return and(
    eq(invitation.organizationId, organizationId),
    eq(invitation.status, "pending"),
    gt(invitation.expiresAt, now ?? new Date()),
  );
}

/**
 * One organization as the caller sees it, with the role they hold in it.
 *
 * Answers `null` for an organization the caller is not in, which is the same
 * answer `resolveMembership` gives and means the same thing — so a route reading
 * this needs no separate membership round trip; the join *is* the check.
 */
export async function getOrganizationForMember(
  db: Database,
  input: { userId: string; organizationId: string },
): Promise<{ organization: OrganizationSummary; role: string } | null> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      createdAt: organization.createdAt,
      role: member.role,
    })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(organization.id, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    organization: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      createdAt: row.createdAt.toISOString(),
    },
    role: row.role,
  };
}

/**
 * One page of the organizations the caller belongs to, oldest membership first.
 *
 * Better Auth's `/organization/list-organizations` cannot be used for this
 * twice over: it sits behind a session (`orgSessionMiddleware`), so it can only
 * answer a caller holding a cookie — and the MCP Worker has an OAuth grant
 * rather than a session — and it is unbounded, reading every membership an
 * account has ever accumulated. Same split, same reasons, as
 * `listOrganizationMembers` and `listPendingInvitations`.
 *
 * **The join is the guard**, exactly as in `getOrganizationForMember`: rows come
 * from `member` filtered by `userId`, so there is no organization id on the way
 * in and nothing a caller could point at somebody else's tenant. That is why it
 * carries no `callerIsMember` clause — there is no target to check.
 *
 * The order is the one `resolveMembership` and `session-hooks.ts` already treat
 * as canonical (oldest membership first, `id` breaking ties), so the first row
 * here is the organization a new session starts in and the one the sidebar
 * switcher shows. An unstable order would page a row twice while skipping
 * another.
 */
export async function listOrganizationsForMember(
  db: Database,
  input: { userId: string; limit: number; offset: number },
): Promise<Page<{ organization: OrganizationSummary; role: string }>> {
  const scope = eq(member.userId, input.userId);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        createdAt: organization.createdAt,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(scope)
      .orderBy(asc(member.createdAt), asc(member.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(member).where(scope),
  ]);

  return {
    rows: rows.map((row) => ({
      organization: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        logo: row.logo,
        createdAt: row.createdAt.toISOString(),
      },
      role: row.role,
    })),
    total: totals[0]?.value ?? 0,
  };
}

/**
 * One page of an organization's members, oldest first.
 *
 * Better Auth's `/organization/list-members` paginates properly and the members
 * page uses it as-is — but it sits behind `orgSessionMiddleware`
 * (`plugins/organization/call.mjs`), so it can only ever answer a caller holding
 * a session cookie. `/api/v1` also serves bearer tokens, which have no session
 * at all, so the same list has to be readable without one.
 *
 * The order matches what that endpoint is asked for on the members page
 * (`createdAt` ascending), with `id` breaking ties — two rows seeded in the same
 * second are otherwise ordered by nothing, and an unstable order pages a row
 * twice while skipping another.
 */
export async function listOrganizationMembers(
  db: Database,
  input: { userId: string; organizationId: string; limit: number; offset: number },
): Promise<Page<OrganizationMemberSummary>> {
  const scope = and(eq(member.organizationId, input.organizationId), callerIsMember(db, input));

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: member.id,
        userId: member.userId,
        name: user.name,
        email: user.email,
        role: member.role,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(scope)
      .orderBy(asc(member.createdAt), asc(member.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(member).where(scope),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    })),
    total: totals[0]?.value ?? 0,
  };
}

/**
 * One membership row, but only if it is in the caller's own organization.
 *
 * The reason the API resolves its target itself instead of handing an id
 * straight to better-auth. `remove-member` looks the id up **globally** and only
 * compares organizations *after* running the last-owner check
 * (`crud-members.mjs`), so a foreign member id can come back
 * `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER` instead of
 * `MEMBER_NOT_FOUND` — which tells the caller whether an id they do not own
 * belongs to an owner. `update-member-role` answers such an id 403 and
 * `cancel-invitation` 400, so all three of them distinguish "absent" from
 * "somebody else's". Resolving here collapses the two: a `null` is a 404 either
 * way, and ids stop being a cross-tenant oracle.
 */
export async function findOrganizationMember(
  db: Database,
  input: { userId: string; organizationId: string; memberId: string },
): Promise<MemberRef | null> {
  const rows = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, input.memberId),
        eq(member.organizationId, input.organizationId),
        callerIsMember(db, input),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One pending invitation, but only if it is in the caller's own organization.
 *
 * The revoke route's 404 pre-check, and the same collapse
 * `findOrganizationMember` performs: better-auth's `cancel-invitation` resolves
 * the id globally and then fails on the *membership* lookup, so an id from
 * another tenant is distinguishable from one that never existed.
 */
export async function findPendingInvitation(
  db: Database,
  input: { userId: string; organizationId: string; invitationId: string; now?: Date },
): Promise<PendingInvitationSummary | null> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, input.invitationId),
        pendingIn(input.organizationId, input.now),
        callerIsMember(db, input),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
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
 * The `callerIsMember` clause is the **guard**, not decoration — see the note on
 * that helper for why an organization id arriving on a request proves nothing.
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
  const scope = and(pendingIn(input.organizationId, input.now), callerIsMember(db, input));

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
