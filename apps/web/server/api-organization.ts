import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  can,
  findOrganizationMember,
  findPendingInvitation,
  getOrganizationForMember,
  listOrganizationMembers,
  listPendingInvitations,
  ORG_CAPABILITIES,
  PRODUCT_REFUSAL_CODES,
  rejectRequest,
  requireInteractivePrincipal,
  requireOrganization,
  ROLES,
  type OrgCapability,
  type PrincipalEnv,
} from "@starter/auth";
import { RATE_LIMIT_RULES, rateLimitClassFor, rateLimitKey } from "@starter/auth/rate-limit";
import { parseEnv, webEnvSchema } from "@starter/config/env";
import { PAGE_SIZE } from "../app/lib/pagination";

/**
 * The organization surface of `/api/v1`, mounted into `api.ts`.
 *
 * Its own file because `api.ts` owns the guards, the mount and the terminal
 * 404 — one reason to change — and these seven routes are another. They are
 * registered with their full `/organization/...` paths and mounted at the API
 * root rather than under a `/organization` prefix, so what `@hono/zod-openapi`
 * advertises at `/doc` is exactly the string a reader (and `check:docs-sync`)
 * sees here.
 *
 * ## What decides what
 *
 * - **The tenant is the principal's, never the request's.** No route reads an
 *   organization id from a path, query or body. A session carries
 *   `activeOrganizationId`; a token carries the organization it was minted in.
 *   Same rule as `/dashboard/members`, and for the same reason: a page — or an
 *   endpoint — whose tenant is a parameter is one that reads another tenant the
 *   moment somebody edits it.
 * - **The role matrix is `ORG_CAPABILITIES`, read through `can()`.** Not
 *   restated here, not re-derived with `hasRole`. Two matrices that agree today
 *   disagree after the first edit.
 * - **Better Auth is what enforces the writes.** Every mutation delegates to
 *   `auth.api.*`, so `ORGANIZATION_ROLES` and `organizationHooks` (the
 *   invite-as-owner ban) stay the single enforcement point. `can()` here decides
 *   which refusal the caller *hears* first, and keeps a doomed request from
 *   costing a round trip — it is not a second guard.
 *
 * ## Why the targets are resolved here first
 *
 * Better Auth resolves a member or invitation id **globally** and only compares
 * organizations afterwards, so the three write endpoints answer a foreign id
 * three different ways — `remove-member` even runs its last-owner check first,
 * which reports whether an id you do not own belongs to an owner. Each route
 * below therefore resolves its target through an org-scoped read
 * (`findOrganizationMember` / `findPendingInvitation`) and answers **404** when
 * it comes back empty. Missing and belonging-to-someone-else are the same
 * answer, so an id cannot be used to probe another tenant.
 */
export const organizationApp = new OpenAPIHono<PrincipalEnv>();

/* -------------------------------------------------------------------------- */
/*                                   schemas                                  */
/* -------------------------------------------------------------------------- */

const ErrorSchema = z.object({
  error: z.string(),
  /** Better Auth's own code, where the refusal came from it. */
  code: z.string().optional(),
});

const unauthorized = {
  401: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Missing or invalid credentials",
  },
} as const;

const forbidden = {
  403: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "No active organization, or the caller's role does not permit this",
  },
} as const;

const notFound = {
  404: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "No such member or invitation in the caller's organization",
  },
} as const;

const refused = {
  400: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "The organization refused the write — see `code`",
  },
} as const;

const throttled = {
  429: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Rate limited",
  },
} as const;

/**
 * The capability flags, derived from the matrix rather than listed.
 *
 * Adding a capability to `ORG_CAPABILITIES` therefore adds it to the spec and to
 * every response, with no edit here. Listing them by hand is the thing this
 * whole file is trying not to do.
 */
const CAPABILITY_KEYS = Object.keys(ORG_CAPABILITIES) as OrgCapability[];

const CapabilitiesSchema = z.object(
  Object.fromEntries(CAPABILITY_KEYS.map((capability) => [capability, z.boolean()])) as Record<
    OrgCapability,
    z.ZodBoolean
  >,
);

function capabilitiesFor(role: string): Record<OrgCapability, boolean> {
  return Object.fromEntries(
    CAPABILITY_KEYS.map((capability) => [capability, can(role, capability)]),
  ) as Record<OrgCapability, boolean>;
}

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  createdAt: z.string(),
  /** The caller's own role in it. */
  role: z.string(),
  capabilities: CapabilitiesSchema,
});

const MemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string(),
});

const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * `limit`/`offset`, bounded by the same `PAGE_SIZE` the members page reads under.
 *
 * The cap is a cost decision, not a layout one: D1 bills rows scanned, so the
 * API asking for more rows per request than the page does would make the same
 * data more expensive to read through the other door. `offset` is what reaches
 * the rest.
 */
const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

/* -------------------------------------------------------------------------- */
/*                                   guards                                   */
/* -------------------------------------------------------------------------- */

/**
 * The sentence a token caller hears here.
 *
 * Same family as token management's, and the same rule for a related reason: a
 * token that can promote its own owner to `owner` turns one leaked credential
 * into permanent control of the organization, which revoking that token does not
 * undo. Reads are open to tokens; writes are not.
 */
const MEMBERSHIP_IS_INTERACTIVE =
  "Organization membership can only be changed from an interactive session";

interface OrganizationScope {
  userId: string;
  organizationId: string;
  role: string;
}

/**
 * Resolve who is asking, which organization they are asking about, and whether
 * their role permits it — in that order, because each answer only makes sense
 * once the one before it holds.
 *
 * The membership lookup is not ceremony: `requireOrganization` reports what the
 * *credential* claims, and neither claim is proof. `removeMember` clears the
 * session of the person doing the removing and never the removed member's, so a
 * session outlives the membership it names; and a token's `organizationId` is
 * stamped once at creation, so it can name an organization its owner has since
 * been thrown out of.
 */
async function organizationScope(
  c: Context<PrincipalEnv>,
  options: { capability?: OrgCapability; interactive?: boolean } = {},
): Promise<OrganizationScope> {
  // Before the organization, because it is a property of the credential rather
  // than of the tenant: a token should hear why it was refused, not that it has
  // no active organization.
  if (options.interactive) requireInteractivePrincipal(c, MEMBERSHIP_IS_INTERACTIVE);

  const { principal, organizationId } = requireOrganization(c);

  const membership = await getOrganizationForMember(c.get("db"), {
    userId: principal.userId,
    organizationId,
  });
  if (!membership) rejectRequest(403, "You are not a member of this organization");

  if (options.capability && !can(membership.role, options.capability)) {
    rejectRequest(403, "Your role does not permit this");
  }

  return { userId: principal.userId, organizationId, role: membership.role };
}

/* -------------------------------------------------------------------------- */
/*                              better-auth bridge                            */
/* -------------------------------------------------------------------------- */

/**
 * The Better Auth path each write is counted under.
 *
 * **The same string better-auth keys its own limiter with**, so a caller
 * spending the organization's sending reputation gets one budget whichever door
 * they come through rather than one per surface. The class is not restated
 * either — `rateLimitClassFor` is the same classifier the storage adapter uses,
 * so `/organization/invite-member` lands in `mail` (3/60s) here because it lands
 * there there.
 *
 * (`apps/mcp` deliberately keys its `/authorize` login under a name of its own.
 * That is a different case: two genuinely different endpoints, where pretending
 * to share one bucket would be a lie. These four *are* the better-auth endpoint,
 * reached through another front door.)
 */
const WRITE_PATHS = {
  invite: "/organization/invite-member",
  revokeInvitation: "/organization/cancel-invitation",
  changeRole: "/organization/update-member-role",
  removeMember: "/organization/remove-member",
} as const;

/**
 * Charge this request to the limiter, and refuse it if the bucket is empty.
 *
 * **Called after the target has been resolved, and before the write.** A request
 * that is about to 404 has already been refused on tenancy grounds, and spending
 * a member's budget on it would let one stale page id throttle the writes they
 * are entitled to make. It is not a probing oracle: the caller is already a
 * member with a session, the ids are not guessable, and the answer is the same
 * 404 either way — what a volumetric attempt runs into is the WAF rule concern
 * #3 names, not this. Invite is the exception only because it has no target to
 * resolve, so its charge is the first thing that happens.
 *
 * Required because these routes reach Better Auth through `auth.api.*`, which
 * bypasses the limiter entirely — it lives in the HTTP router's `onRequest`
 * hook, and nothing else stands between `/api/v1` and the write. Skipping it
 * would leave the strict `mail` class enforced on the browser's invite and
 * unenforced one path over, which is exactly the shape of audit #4.
 *
 * Through `parseEnv` rather than `c.env`, so a renamed binding refuses the
 * request instead of reaching `.limit` on `undefined` and 500ing further down.
 */
async function chargeRateLimit(c: Context<PrincipalEnv>, path: string): Promise<void> {
  const env = parseEnv(webEnvSchema, c.env);
  const limiters = {
    default: env.RATE_LIMIT_DEFAULT,
    credentials: env.RATE_LIMIT_CREDENTIALS,
    mail: env.RATE_LIMIT_MAIL,
  };

  const limitClass = rateLimitClassFor(path);
  const { success } = await limiters[limitClass].limit({
    key: rateLimitKey(c.req.raw.headers, path),
  });

  if (!success) {
    rejectRequest(429, "Too many requests. Please try again later.", {
      // Derived, never written out: `RATE_LIMIT_RULES` is the policy, and a
      // literal here would keep reporting 60 after the binding moved to 10.
      headers: { "Retry-After": String(RATE_LIMIT_RULES[limitClass].window) },
    });
  }
}

/** Better Auth's `APIError`, recognised the way better-auth's own `isAPIError` does. */
function isApiError(error: unknown): error is { statusCode: number; body?: { code?: string } } {
  return error instanceof Error && error.name === "APIError";
}

/**
 * Run a Better Auth write and turn its refusal into this API's envelope.
 *
 * The caller's role and the target's tenancy were both settled before the call,
 * so what is left is the organization's own rules — the last owner, an address
 * already invited, an invitation that tried to hand out `owner`. Those answer
 * **400** carrying the `code`, which is the same vocabulary
 * `app/lib/member-action-errors.ts` turns into sentences, so an API client and
 * the browser branch on one set of names.
 *
 * **Two kinds of 403 arrive here and they are not the same thing.**
 *
 * Better Auth's own means *your role does not permit this*, which on this
 * surface can only happen when `can()` above and `ORGANIZATION_ROLES` disagree —
 * a bug in this repo, not something the caller can act on. It is left to escape
 * as a 500 with a correlation id rather than told to the caller as if they had
 * asked for something they lack the role for.
 *
 * A **product** refusal from `organizationHooks` arrives as 403 only because
 * that is the status a hook can throw with. `beforeCreateInvitation` is the one
 * today: an owner *is* allowed to invite, and what is refused is the role in the
 * body. `PRODUCT_REFUSAL_CODES` is what tells the two apart, and it lives beside
 * the hooks rather than here so a second rule cannot be added without meeting
 * it — this exact case shipped as an unhandled 500 while the browser path had
 * asserted 403 on it all along, because the unit test mocked a 400 the hook
 * never throws.
 *
 * It answers **400 rather than the browser's 403** on purpose. Nothing is wrong
 * with the credential: 403 on this app means "no active organization, or your
 * role does not permit this", and a refused value in a request body is neither.
 * The `code` is identical across both doors, and that is what clients branch on.
 */
async function delegate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isApiError(error)) throw error;

    const code = error.body?.code;
    const isProductRule = code !== undefined && PRODUCT_REFUSAL_CODES.has(code);

    if (error.statusCode === 400 || isProductRule) {
      rejectRequest(400, "The organization refused that change.", { code });
    }

    throw error;
  }
}

/** Better Auth hands back `Date`s; the wire carries ISO strings. */
function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/* -------------------------------------------------------------------------- */
/*                                    routes                                  */
/* -------------------------------------------------------------------------- */

const getOrganizationRoute = createRoute({
  method: "get",
  path: "/organization",
  responses: {
    200: {
      content: { "application/json": { schema: OrganizationSchema } },
      description: "The caller's active organization, and what their role permits",
    },
    ...unauthorized,
    ...forbidden,
  },
});

organizationApp.openapi(getOrganizationRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c);

  // Resolved a second time rather than threaded out of the guard: this is the
  // one route whose payload *is* the organization, and the guard returns the
  // role because that is what every other route needs from it.
  const found = await getOrganizationForMember(c.get("db"), { userId, organizationId });
  if (!found) rejectRequest(403, "You are not a member of this organization");

  return c.json(
    { ...found.organization, role: found.role, capabilities: capabilitiesFor(found.role) },
    200,
  );
});

const listMembersRoute = createRoute({
  method: "get",
  path: "/organization/members",
  request: { query: PageQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ members: z.array(MemberSchema), total: z.number() }),
        },
      },
      description: "One page of the organization's members, oldest first",
    },
    ...unauthorized,
    ...forbidden,
  },
});

organizationApp.openapi(listMembersRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c);
  const { limit, offset } = c.req.valid("query");

  const page = await listOrganizationMembers(c.get("db"), {
    userId,
    organizationId,
    limit,
    offset,
  });

  return c.json({ members: page.rows, total: page.total }, 200);
});

const listInvitationsRoute = createRoute({
  method: "get",
  path: "/organization/invitations",
  request: { query: PageQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ invitations: z.array(InvitationSchema), total: z.number() }),
        },
      },
      description: "One page of invitations that have not been spent, newest first",
    },
    ...unauthorized,
    ...forbidden,
  },
});

// Admin and owner only. The rows carry addresses nobody else in the
// organization has seen, which is why `readInvitations` is a capability of its
// own rather than something every member gets (#36).
organizationApp.openapi(listInvitationsRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c, { capability: "readInvitations" });
  const { limit, offset } = c.req.valid("query");

  const page = await listPendingInvitations(c.get("db"), {
    userId,
    organizationId,
    limit,
    offset,
  });

  return c.json({ invitations: page.rows, total: page.total }, 200);
});

const createInvitationRoute = createRoute({
  method: "post",
  path: "/organization/invitations",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            /**
             * `owner` is accepted by the schema and refused by the hook, on
             * purpose: nobody is invited as an owner — that is a promotion, so
             * it happens to somebody already inside — and the refusal that says
             * so carries `OWNER_MUST_BE_PROMOTED_NOT_INVITED`. A zod `enum`
             * without it would answer a bare validation error instead, and the
             * rule would live in two places.
             */
            role: z.enum(ROLES),
            /**
             * Better Auth's own flag on this endpoint, not a second path: it
             * keeps the invitation id, extends `expiresAt`, and the link already
             * sent goes on working. Same `mail` budget for the same reason.
             */
            resend: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: InvitationSchema } },
      description: "The invitation, created or re-sent",
    },
    ...unauthorized,
    ...forbidden,
    ...refused,
    ...throttled,
  },
});

organizationApp.openapi(createInvitationRoute, async (c) => {
  const { organizationId } = await organizationScope(c, {
    capability: "invite",
    interactive: true,
  });
  const { email, role, resend } = c.req.valid("json");

  await chargeRateLimit(c, WRITE_PATHS.invite);

  const invitation = await delegate(() =>
    c.get("auth").api.createInvitation({
      headers: c.req.raw.headers,
      body: { email, role, resend, organizationId },
    }),
  );

  return c.json(
    {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: iso(invitation.expiresAt),
      createdAt: iso(invitation.createdAt) ?? new Date().toISOString(),
    },
    201,
  );
});

const revokeInvitationRoute = createRoute({
  method: "delete",
  path: "/organization/invitations/{id}",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ revoked: z.boolean() }) } },
      description: "The invitation was withdrawn",
    },
    ...unauthorized,
    ...forbidden,
    ...notFound,
    ...refused,
    ...throttled,
  },
});

organizationApp.openapi(revokeInvitationRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c, {
    capability: "revokeInvitation",
    interactive: true,
  });
  const { id } = c.req.valid("param");

  // Scoped, so an invitation from another organization is indistinguishable
  // from one that never existed. The predicate is the list's, so an id the list
  // will never show is an id this route answers 404 for.
  const invitation = await findPendingInvitation(c.get("db"), {
    userId,
    organizationId,
    invitationId: id,
  });
  if (!invitation) rejectRequest(404, "Invitation not found");

  await chargeRateLimit(c, WRITE_PATHS.revokeInvitation);

  await delegate(() =>
    c.get("auth").api.cancelInvitation({
      headers: c.req.raw.headers,
      body: { invitationId: invitation.id },
    }),
  );

  return c.json({ revoked: true }, 200);
});

const changeRoleRoute = createRoute({
  method: "patch",
  path: "/organization/members/{id}",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({ role: z.enum(ROLES) }) } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ id: z.string(), userId: z.string(), role: z.string() }),
        },
      },
      description: "The membership, with its new role",
    },
    ...unauthorized,
    ...forbidden,
    ...notFound,
    ...refused,
    ...throttled,
  },
});

organizationApp.openapi(changeRoleRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c, {
    capability: "changeRole",
    interactive: true,
  });
  const { id } = c.req.valid("param");
  const { role } = c.req.valid("json");

  const target = await findOrganizationMember(c.get("db"), {
    userId,
    organizationId,
    memberId: id,
  });
  if (!target) rejectRequest(404, "Member not found");

  await chargeRateLimit(c, WRITE_PATHS.changeRole);

  // The last-owner rule is better-auth's own and stays there: it is a fact about
  // the organization's state at the moment of the write, and re-deciding it here
  // would be a second copy that a concurrent demotion makes wrong.
  await delegate(() =>
    c.get("auth").api.updateMemberRole({
      headers: c.req.raw.headers,
      body: { memberId: target.id, role, organizationId },
    }),
  );

  return c.json({ id: target.id, userId: target.userId, role }, 200);
});

const removeMemberRoute = createRoute({
  method: "delete",
  path: "/organization/members/{id}",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ removed: z.boolean() }) } },
      description: "The membership ended",
    },
    ...unauthorized,
    ...forbidden,
    ...notFound,
    ...refused,
    ...throttled,
  },
});

organizationApp.openapi(removeMemberRoute, async (c) => {
  const { userId, organizationId } = await organizationScope(c, {
    capability: "removeMember",
    interactive: true,
  });
  const { id } = c.req.valid("param");

  const target = await findOrganizationMember(c.get("db"), {
    userId,
    organizationId,
    memberId: id,
  });
  if (!target) rejectRequest(404, "Member not found");

  await chargeRateLimit(c, WRITE_PATHS.removeMember);

  /*
   * An owner passing their **own** member id is allowed through, and that is
   * deliberate rather than an oversight. It is the same write better-auth
   * performs for `leave` — including clearing their active organization — and
   * the last-owner rule fires either way. "Own row shows Leave, never Remove" is
   * a rule about what the members page renders; inventing an API-only refusal
   * here would be a second matrix with nothing to enforce it.
   *
   * The id is `target.id`, never the request's, so what is removed is the row
   * that was verified to be in this organization.
   */
  await delegate(() =>
    c.get("auth").api.removeMember({
      headers: c.req.raw.headers,
      body: { memberIdOrEmail: target.id, organizationId },
    }),
  );

  return c.json({ removed: true }, 200);
});
