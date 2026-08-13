import { describe, expect, it } from "vitest";
import * as db from "../index";

/**
 * The regression these guard is a *compile* failure, not a runtime one: pnpm's
 * isolated node_modules does not expose a transitive dependency, so an app
 * importing `eq` from `drizzle-orm` directly fails with TS2307 until it
 * declares its own copy. Re-exporting here keeps the version pinned in one
 * place. Dropping a name from that list is what this notices.
 */
describe("query operators are reachable from the package entry", () => {
  it.each(["eq", "and", "or", "not", "count", "desc", "asc", "inArray", "isNull", "sql"])(
    "exports %s",
    (name) => {
      expect(db[name as keyof typeof db]).toBeDefined();
    },
  );

  it("does not shadow a table export with an operator of the same name", () => {
    // `sql` and `count` are the collision-prone ones; both must be the drizzle
    // helpers, not something re-exported from ./schema.
    expect(typeof db.sql).toBe("function");
    expect(typeof db.count).toBe("function");
  });
});
