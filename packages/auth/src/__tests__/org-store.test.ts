import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type Database } from "@starter/db";
import { createFakeD1, epochSeconds } from "@starter/testing/fake-d1";
import { listOrganizationsForMember } from "../helpers/org-store";
import { PAGE_SIZE } from "../pagination";

/**
 * `listOrganizationsForMember` against a real SQLite carrying this repo's own
 * migrations.
 *
 * **A departure from the standing precedent, and a deliberate one.** The other
 * drizzle stores here are mocked at their consumers and proven by e2e, because
 * unit tests had no database to run against. That works while every store is
 * reachable through an HTTP route a Playwright spec can drive — and this one is
 * not: it exists for the MCP list tools (#39), which sit behind an OAuth 2.1
 * grant that no e2e spec obtains. Left to the precedent it would be the one
 * tenancy-scoped read in the repo that nothing exercises.
 *
 * So it is tested where it lives, with `createFakeD1`. The queries are real, the
 * schema is the migrations', and the scope clause has to actually be there.
 */

const NOW = new Date("2026-08-19T00:00:00.000Z");

let d1: ReturnType<typeof createFakeD1>;
let db: Database;

function addUser(id: string) {
  d1.insert("user", {
    id,
    email: `${id}@example.com`,
    name: id,
    emailVerified: 1,
    createdAt: epochSeconds(NOW),
    updatedAt: epochSeconds(NOW),
  });
}

function addOrganization(id: string, logo: string | null = null) {
  d1.insert("organization", {
    id,
    name: `Org ${id}`,
    slug: id,
    logo,
    createdAt: epochSeconds(NOW),
  });
}

/** `age` in seconds, so "oldest membership first" is a real ordering to assert. */
function addMember(id: string, organizationId: string, userId: string, role: string, age = 0) {
  d1.insert("member", {
    id,
    organizationId,
    userId,
    role,
    createdAt: epochSeconds(new Date(NOW.getTime() + age * 1000)),
  });
}

const list = (userId: string, window: { limit?: number; offset?: number } = {}) =>
  listOrganizationsForMember(db, {
    userId,
    limit: window.limit ?? PAGE_SIZE,
    offset: window.offset ?? 0,
  });

beforeEach(() => {
  d1 = createFakeD1();
  db = createDb(d1);

  addUser("ana");
  addUser("dia");

  addOrganization("trading", "https://cdn.test/logo.png");
  addOrganization("holdings");

  addMember("mem_ana", "trading", "ana", "owner");
  addMember("mem_dia", "holdings", "dia", "owner");
});

afterEach(() => {
  d1.close();
});

describe("listOrganizationsForMember", () => {
  it("returns the organization with the caller's role in it", async () => {
    await expect(list("ana")).resolves.toEqual({
      rows: [
        {
          organization: {
            id: "trading",
            name: "Org trading",
            slug: "trading",
            logo: "https://cdn.test/logo.png",
            createdAt: "2026-08-19T00:00:00.000Z",
          },
          role: "owner",
        },
      ],
      total: 1,
    });
  });

  it("carries a null logo through rather than dropping the field", async () => {
    const page = await list("dia");

    expect(page.rows[0].organization.logo).toBeNull();
  });

  /* -------------------------------- the guard ------------------------------ */

  /**
   * The deny path. `holdings` is a real, populated organization — it is simply
   * not one of Ana's — so this is the `WHERE` clause being load-bearing rather
   * than a query that happened to match nothing.
   */
  it("never returns an organization the caller is not a member of", async () => {
    const page = await list("ana");

    expect(page.rows.map((row) => row.organization.id)).toEqual(["trading"]);
    expect(page.total).toBe(1);
  });

  it("returns nothing for an account with no memberships", async () => {
    addUser("nobody");

    await expect(list("nobody")).resolves.toEqual({ rows: [], total: 0 });
  });

  it("counts only the caller's memberships, not every row in the table", async () => {
    addMember("mem_ana_2", "holdings", "ana", "member", 1);

    const [ana, dia] = await Promise.all([list("ana"), list("dia")]);

    expect(ana.total).toBe(2);
    expect(dia.total).toBe(1);
  });

  it("reports the role held in each organization, not one role for all", async () => {
    addMember("mem_ana_2", "holdings", "ana", "member", 1);

    const page = await list("ana");

    expect(page.rows.map((row) => [row.organization.id, row.role])).toEqual([
      ["trading", "owner"],
      ["holdings", "member"],
    ]);
  });

  /* ------------------------------- pagination ------------------------------ */

  describe("with more organizations than one page", () => {
    beforeEach(() => {
      for (let index = 0; index < PAGE_SIZE + 4; index++) {
        addOrganization(`extra_${index}`);
        addMember(`mem_extra_${index}`, `extra_${index}`, "ana", "member", 10 + index);
      }
    });

    it("returns at most the window it is given", async () => {
      const page = await list("ana", { limit: PAGE_SIZE });

      expect(page.rows).toHaveLength(PAGE_SIZE);
    });

    it("reports the unfiltered total beside the page", async () => {
      const page = await list("ana", { limit: 5 });

      expect(page.rows).toHaveLength(5);
      expect(page.total).toBe(PAGE_SIZE + 5);
    });

    /*
     * The tie-break on `id` is why this holds: two memberships written in the
     * same second are otherwise ordered by nothing, and an unstable order pages
     * one row twice while skipping another.
     */
    it("pages without repeating or skipping a row", async () => {
      const [first, second] = await Promise.all([
        list("ana", { limit: PAGE_SIZE, offset: 0 }),
        list("ana", { limit: PAGE_SIZE, offset: PAGE_SIZE }),
      ]);
      const ids = [...first.rows, ...second.rows].map((row) => row.organization.id);

      expect(ids).toHaveLength(PAGE_SIZE + 5);
      expect(new Set(ids).size).toBe(PAGE_SIZE + 5);
    });

    it("returns an empty page past the end, with the total intact", async () => {
      const page = await list("ana", { limit: PAGE_SIZE, offset: 100 });

      expect(page.rows).toEqual([]);
      expect(page.total).toBe(PAGE_SIZE + 5);
    });

    // Oldest membership first — the row `resolveMembership` and
    // `session-hooks.ts` both treat as the organization a session starts in.
    it("orders by membership age, oldest first", async () => {
      const page = await list("ana", { limit: 3 });

      expect(page.rows.map((row) => row.organization.id)).toEqual([
        "trading",
        "extra_0",
        "extra_1",
      ]);
    });
  });
});
