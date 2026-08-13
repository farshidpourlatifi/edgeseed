/**
 * How every script addresses the D1 database when it shells out to wrangler.
 *
 * The **binding**, never the database name. `wrangler d1` accepts either, and
 * the name is the wrong one to depend on: `init:product` stamps
 * `database_name` to `<slug>-db` in a clone, so a script naming the starter's
 * database resolves to nothing the moment a product renames itself. That is
 * not hypothetical — it is what the clean-clone exercise for #17 hit, and the
 * failure is badly misreported: `d1 migrations apply` answers "No migrations
 * present at apps/web/migrations" rather than naming the database it could not
 * find, sending the reader off to look for their migrations.
 *
 * The binding is stable by construction. Everything reads `c.env.DB` —
 * `packages/auth` middleware, `sharedEnvSchema`, `apps/mcp/src/env.ts` — and
 * the wrangler configs carry a comment warning against letting `d1 create`
 * append a second, differently-named binding. So `DB` is the one identifier a
 * clone cannot rename without breaking the app itself.
 */
export const D1_BINDING = "DB";
