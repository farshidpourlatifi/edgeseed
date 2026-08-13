export { createDb } from "./client";
export type { Database } from "./client";
export * from "./schema/index";

/**
 * Drizzle's query operators, re-exported so a consumer can write a `where`
 * clause without declaring `drizzle-orm` itself.
 *
 * Not convenience — the alternative does not compile. pnpm's isolated
 * `node_modules` does not expose a transitive dependency, so an app importing
 * `eq` straight from `drizzle-orm` fails with TS2307 until it adds its own
 * entry, and that entry is a second place to pin a version that
 * `better-auth` already constrains to `^0.45.2` (AGENTS.md, "Keep zod on one
 * major"). One pin, one import path.
 *
 * The starter never hit this because no app queries D1 directly — every query
 * lives in `@starter/auth` or here. The first product feature discovers it,
 * which is exactly what the #17 clean-clone exercise did.
 *
 * Add operators as they are needed rather than `export *`: the surface stays
 * legible, and a name added upstream cannot silently collide with a table
 * exported from `./schema/index`.
 */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
