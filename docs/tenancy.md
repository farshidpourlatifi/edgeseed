# Extending the tenancy model

How a downstream product adds its own organization-scoped tables, pages, API
routes and MCP tools on top of what the starter ships.

The starter's own organization surface — creating one, inviting people, roles,
removal — is finished and is not the subject here. This is about the layer
above it: the product's data, scoped to the tenant the starter already
resolves.

Read [`AGENTS.md`](../AGENTS.md) first. Everything below applies its rules to a
new feature rather than restating them; where the two ever disagree, `AGENTS.md`
is canonical.

---

## What you inherit

| Thing                                         | Where                                    |
| --------------------------------------------- | ---------------------------------------- |
| `organization`, `member`, `invitation` tables | `packages/db/src/schema.ts`              |
| The capability matrix, `ORG_CAPABILITIES`     | `packages/auth/src/helpers/roles.ts`     |
| Better Auth's narrowed role table             | `packages/auth/src/organization.ts`      |
| Tenant resolution and the scoped read helpers | `packages/auth/src/helpers/org-store.ts` |
| The bounded-list page size                    | `packages/auth/src/pagination.ts`        |
| The API's default-deny guard and principal    | `apps/web/server/api.ts`                 |

Three properties hold across all of it, and your feature has to keep them:

1. **The tenant comes from the credential, never from the request.** A session
   carries `activeOrganizationId`; an API token is stamped with one at creation;
   an MCP grant carries neither, which is why MCP — and only MCP — takes an
   organization id as an argument.
2. **A foreign id and a nonexistent id get the same answer.** 404 on `/api/v1`,
   the same refusal sentence in MCP. Two different answers turn an id into an
   oracle for probing another tenant.
3. **The guard lives where the data is read**, not one layer above it.

---

## Adding an organization-scoped table

```ts
export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("project_organizationId_idx").on(table.organizationId)],
);
```

Three things are load-bearing:

- **`onDelete: "cascade"` on the tenant foreign key.** Deleting an organization
  must not fail on your table or strand its rows. The starter closed exactly
  this gap for its own tables in #13; a new table reopens it.
- **An index on every foreign-key child column.** D1 bills rows _scanned_, and a
  cascade with no index reads the whole table. `packages/db`'s `schema.test.ts`
  asserts the starter's index set exactly — a new index needs a stated consumer
  and a missing one fails. Keep your tables to the same rule.
- **Migrate before the code that needs it, in two releases** — expand, then
  contract. And if your change touches a foreign key, read the D1 pragma
  warning in `AGENTS.md` under "Schema changes" before generating it: the SQL
  drizzle-kit emits is not D1-safe until `db:generate` rewrites it, and the
  local migration passes either way.

---

## Adding a page

An organization-scoped loader resolves its tenant with `resolveMembership`, and
guards itself:

```ts
export async function loader({ context, request }: Route.LoaderArgs) {
  const session = await requireUser(context, request);

  const membership = await resolveMembership(context.db, {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId,
  });
  // `null` is a state to render — "pick an organization" — not a 500.
  if (!membership) return { organization: null, projects: [] };

  return {
    organization: membership.organization,
    projects: await listProjects(context.db, {
      userId: session.user.id,
      organizationId: membership.organization.id,
    }),
  };
}
```

- **`requireUser` in every loader, children included.** In React Router v7 the
  dashboard layout loader is not a security boundary: children run in parallel
  with it and a `.data` request can fetch one directly.
- **Never take the organization from the URL.** The round trip through
  `resolveMembership` is not ceremony: a session outlives a removal, so
  `activeOrganizationId` can name an organization the caller was just thrown out
  of.
- **The lookup is not the guard.** `listProjects` still scopes itself — pass
  `userId` into the query and join through `member`, the way
  `listOrganizationMembers` does, so a stale membership cannot return rows.

---

## Adding an API route

Register it on `apiApp` (or a sub-app mounted above its terminal `all("*")`),
and copy the `organizationScope` shape from
[`apps/web/server/api-organization.ts`](../apps/web/server/api-organization.ts) —
it is local to that file on purpose, because the ladder it walks is the thing
worth copying rather than a helper to import blindly:

1. `requireInteractivePrincipal` **first** if the route is a write that a token
   must not perform — it is a property of the credential, so the caller should
   hear that rather than "you have no active organization".
2. `requireOrganization` for the tenant, from the principal.
3. `getOrganizationForMember` — refuse if the caller is not in it.
4. `can(role, capability)` if the route is capability-gated.
5. Only then read or write, with the organization in the `WHERE` clause.

Then:

- **Take no organization id parameter.** The tenant is the principal's. A route
  that accepts one has to defend it; a route that does not, cannot be attacked
  that way.
- **Answer 404, never 403, for a target in another tenant.** A member or row
  outside the caller's organization does not exist as far as they are concerned.
- **Paginate.** Spread the shared page-size cap rather than inventing a limit.
- The route is authenticated by default. Making it public means adding it to
  `PUBLIC_OPERATIONS` by method and path, deliberately.
- Run `pnpm api:spec` afterwards, and add the matching MCP tool.

---

## Adding an MCP tool

MCP is the one surface where an organization id is a legal **argument**, because
an OAuth grant carries no tenant. That makes it a target, not a credential:

```ts
const membership = await getOrganizationForMember(ctx.db, {
  userId: ctx.user.userId,
  organizationId: args.organizationId,
});
if (!membership) return rejectTool(NOT_A_MEMBER);

if (!can(membership.role, "readProjects")) return rejectTool(ROLE_NOT_PERMITTED);
```

- **Identity is `ctx.user`**, from the grant. Never a tool argument.
- **Membership before role**, and a foreign organization must produce the
  **identical** refusal to a nonexistent one.
- `list_organizations` is what hands a client the ids it may target, so nothing
  has to be guessed.
- Spread `pageArgs`; the cap is imported from `@starter/auth/pagination` so MCP
  cannot read the same rows in bigger gulps than the API.

---

## Adding a capability

`ORG_CAPABILITIES` is the single matrix, read through `can(role, capability)` —
never `hasRole` at a call site, which re-decides the policy there.

1. Add the entry to `ORG_CAPABILITIES` **first**, then render and gate from it.
   The API and the MCP list tools derive their reported capabilities from the
   object itself, so both pick it up with no edit.
2. If it maps to a Better Auth permission, make `ORGANIZATION_ROLES` agree.
   `organization.test.ts` asserts every role × capability pair against
   `authorize()`, so it cannot quietly not.
3. **Carry a capability-gated read into its query**, not just into the route
   above it — `callerIsMember` takes an optional capability, resolved through
   `rolesGranting()`. A demotion between the `can()` call and the read would
   otherwise still return the rows.

---

## Testing it

- **Every guard ships its deny-path test**, at the vector rather than at the
  helper. For a loader that means `?_routes=routes%2F<route-id>` — a plain
  `.data` request is satisfied by the layout's guard — and asserting on the
  `SingleFetchRedirect` payload rather than the status, which is 202.
- **Deny paths go at the endpoint, not at a missing button.** The page renders
  no control the reader lacks the role for, so a click-driven deny test asserts
  a button is absent and says nothing about what the server would have answered.
- **A cross-tenant test needs a second tenant that actually has rows.** Refusing
  an id that matches nothing proves much less than refusing one that matches
  somebody else's data.
- [`tests/e2e/organization-lifecycle.spec.ts`](../tests/e2e/organization-lifecycle.spec.ts)
  is the worked example: two real users, nothing seeded, and the same
  cross-tenant question asked of the UI loader, the API and MCP in turn. A
  product adding its own scoped surface should extend that shape rather than
  trusting a unit test that hands itself a tenant.

---

## The one residue no constraint reaches

`invitation.email` has **no foreign key to `user`** — an invitation is addressed
to an email that may not have an account yet, which is the entire point of
inviting somebody. Every other tenant foreign key cascades, so deleting a user
or an organization cleans up after itself. This one cannot.

So an invitation addressed to a deleted user's address survives that deletion,
holding their email indefinitely, and nothing purges expired or accepted rows
either (`docs/security-audit.md` #12).

**Whatever finally adds an account-deletion surface owns an application-level
sweep of `invitation` by address.** It is a GDPR obligation, it is not
enforceable in the schema, and it will not announce itself — the deletion will
appear to succeed. Recorded here because this guide is where somebody extending
the tenancy model is reading, and standing concern #6 in `AGENTS.md` is where it
is tracked.
