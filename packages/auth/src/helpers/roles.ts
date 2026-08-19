/**
 * The organization role matrix — roles, the hierarchy, and who may do what.
 *
 * **A leaf with no imports, and it has to stay one.** `apps/web` reaches it as
 * `@starter/auth/roles` from components that run in the browser; the package
 * index re-exports `createAuth`, so importing the matrix from there drags
 * better-auth into the client bundle for the sake of three string constants.
 * Same rule, same reason, as `invitation.ts`.
 */

/** Organization roles */
export const ROLES = {
  owner: "owner",
  admin: "admin",
  member: "member",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Check if a role has at least the given permission level */
export function hasRole(userRole: string, requiredRole: Role): boolean {
  const hierarchy: Record<string, number> = {
    owner: 3,
    admin: 2,
    member: 1,
  };
  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
}

/**
 * What a role may do to an organization's people — **the** matrix, stated once.
 *
 * Every surface reads it through `can()`: the members page decides which
 * controls exist, and `organization.ts` derives the Better Auth role table that
 * refuses the request when someone posts to the endpoint anyway. The API
 * (#38) and the MCP list tools (#39) import this rather than restate it — two
 * matrices that agree today are two matrices that disagree after the first
 * edit.
 *
 * Three things it says, which the code below cannot say on its own:
 *
 * - **Invite and revoke are admin+.** An admin's whole job is bringing people
 *   in; it costs the organization nothing that removing them does.
 * - **Role changes and removals are owner-only.** They are the two writes that
 *   can lock the organization's owner out of it, so they sit with the role that
 *   would have to live with the result. This is *stricter* than Better Auth's
 *   own `adminAc`, which grants `member: ["update", "delete"]` — see
 *   `organization.ts` for how that default is narrowed and why the narrowing
 *   has to happen there rather than here.
 * - **Leaving is everyone's.** Membership is not a thing a product may trap
 *   someone in. The one refusal is structural rather than about rank — the last
 *   owner cannot leave, because there would be nobody left who could act — and
 *   Better Auth enforces it itself (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`).
 *
 * `leave` maps to `member` rather than being left out: an entry that reads
 * "anyone in the organization" is a decision recorded, while an absent one is
 * indistinguishable from an oversight.
 */
export const ORG_CAPABILITIES = {
  /** Send an invitation, and re-send a pending one (the same endpoint). */
  invite: ROLES.admin,
  /** Withdraw a pending invitation before it is spent. */
  revokeInvitation: ROLES.admin,
  /**
   * See the pending-invitation list at all. The rows carry addresses nobody
   * else in the organization has seen, so a plain member gets no section
   * rather than an empty one (#36).
   */
  readInvitations: ROLES.admin,
  /** Promote or demote somebody. */
  changeRole: ROLES.owner,
  /** Remove somebody else. Removing *yourself* is `leave`, and always allowed. */
  removeMember: ROLES.owner,
  /** Give up your own membership. */
  leave: ROLES.member,
} as const satisfies Record<string, Role>;

export type OrgCapability = keyof typeof ORG_CAPABILITIES;

/**
 * Whether `userRole` may do `capability`.
 *
 * The only comparison a caller should need. Reaching for `hasRole` directly at
 * a call site re-decides the matrix there, which is how two surfaces come to
 * disagree about who may remove a member; an unknown role fails closed here
 * because `hasRole` does.
 */
export function can(userRole: string, capability: OrgCapability): boolean {
  return hasRole(userRole, ORG_CAPABILITIES[capability]);
}

/**
 * Every role that `can()` answers `true` for — the matrix read backwards.
 *
 * Exists so a **query** can enforce a capability without restating who holds
 * it. `can(role, capability)` answers one role at a time, which is all a render
 * or a route needs; a `WHERE` clause needs the set, and the alternative is an
 * `IN ('owner','admin')` literal in SQL that no longer moves when
 * `ORG_CAPABILITIES` does.
 *
 * Derived from `ROLES` through `can()` rather than listed, so it inherits the
 * hierarchy — and inherits failing closed with it: a capability nobody holds
 * yields an empty set, which matches nothing rather than everything.
 */
export function rolesGranting(capability: OrgCapability): Role[] {
  return Object.values(ROLES).filter((role) => can(role, capability));
}

/**
 * The refusal code for an invitation that tried to hand out `owner`.
 *
 * A statement about the matrix, so it lives with it rather than beside the hook
 * that throws it — which is the only way the server that raises it
 * (`organization.ts`) and the browser that renders it
 * (`app/lib/member-action-errors.ts`) can share one string instead of two that
 * have to be kept in step.
 *
 * Better Auth has no code of its own for this case: it refuses a **non**-owner
 * who asks for `owner` and permits an owner who does, so the half this repo
 * closes is the half with no vocabulary for it.
 */
export const OWNER_MUST_BE_PROMOTED = "OWNER_MUST_BE_PROMOTED_NOT_INVITED";

/**
 * Refusals **this product** raises, as opposed to ones Better Auth raises itself.
 *
 * They arrive as `FORBIDDEN`, because that is the only status
 * `organizationHooks` can throw with — but they mean something categorically
 * different from Better Auth's own 403s. Its 403s say *the caller's role does
 * not permit this*, which on `/api/v1/organization/*` can only happen when
 * `can()` and `ORGANIZATION_ROLES` disagree: a bug in this repo, and one that
 * must surface as a 500 with a correlation id rather than be reported to the
 * caller as their own fault. These say *the request asked for something the
 * product forbids* — an answer the caller can act on, and one that has to carry
 * its code.
 *
 * A set rather than a comparison against the one constant, because that
 * distinction is invisible from the throw site: **a new `organizationHooks` rule
 * adds its code here, or the API answers 500 to a refusal it was supposed to
 * explain.** That is exactly how the invite-as-owner case reached `/api/v1` as
 * an unhandled 500 while the browser path had asserted 403 all along.
 */
export const PRODUCT_REFUSAL_CODES: ReadonlySet<string> = new Set([OWNER_MUST_BE_PROMOTED]);
