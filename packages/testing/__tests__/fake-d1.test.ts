import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFakeD1, epochSeconds } from "../fake-d1";

/**
 * The double's own contract.
 *
 * It is typed as a `D1Database`, so the shapes it answers in are a promise to
 * every suite that uses it. The two argument-taking overloads are the ones
 * worth pinning: drizzle calls neither, so nothing else here would notice them
 * drifting — and a fake that dropped the argument would answer `{ value: 7 }`
 * where D1 answers `7`, letting a test assert this file's behaviour instead of
 * D1's.
 */

let d1: ReturnType<typeof createFakeD1>;

beforeEach(() => {
  d1 = createFakeD1();
  d1.insert("user", {
    id: "ana",
    email: "ana@example.com",
    name: "Ana",
    emailVerified: 1,
    createdAt: epochSeconds(new Date("2026-08-19T00:00:00.000Z")),
    updatedAt: epochSeconds(new Date("2026-08-19T00:00:00.000Z")),
  });
});

afterEach(() => d1.close());

describe("createFakeD1", () => {
  it("applies the repo's migrations rather than a fixture schema", async () => {
    const { results } = await d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    const tables = (results as Array<{ name: string }>).map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining(["user", "organization", "member", "invitation"]),
    );
  });

  it("binds parameters rather than interpolating them", async () => {
    const row = await d1.prepare("SELECT name FROM user WHERE id = ?").bind("ana").first();

    expect(row).toEqual({ name: "Ana" });
  });
});

describe("first(columnName)", () => {
  it("returns the bare value, not the row", async () => {
    const value = await d1.prepare("SELECT 7 AS value").first("value");

    expect(value).toBe(7);
  });

  it("returns the whole row when no column is named", async () => {
    expect(await d1.prepare("SELECT 7 AS value").first()).toEqual({ value: 7 });
  });

  it("answers null for no rows at all", async () => {
    expect(await d1.prepare("SELECT name FROM user WHERE id = 'nobody'").first()).toBeNull();
  });

  // D1 throws rather than answering `undefined`, so a test cannot mistake a
  // typo'd column for an empty one.
  it("throws for a column the result does not carry", async () => {
    await expect(d1.prepare("SELECT 7 AS value").first("missing")).rejects.toThrow(
      /no such column/,
    );
  });
});

describe("raw({ columnNames: true })", () => {
  it("prepends the header row", async () => {
    const rows = await d1.prepare("SELECT 7 AS value").raw({ columnNames: true });

    expect(rows).toEqual([["value"], [7]]);
  });

  it("omits the header row by default", async () => {
    expect(await d1.prepare("SELECT 7 AS value").raw()).toEqual([[7]]);
  });

  // The result name, so an alias reports as the caller asked for it — and read
  // off the statement, so it survives an empty result the way D1's does.
  it("reports result names, and carries them even with no rows", async () => {
    const rows = await d1
      .prepare("SELECT id AS userId, name FROM user WHERE id = 'nobody'")
      .raw({ columnNames: true });

    expect(rows).toEqual([["userId", "name"]]);
  });
});

describe("batch()", () => {
  // Refuses rather than silently answering nothing: a caller reaching for it
  // has to find out here, not from an assertion that passed against no rows.
  it("throws rather than pretending to run", async () => {
    await expect(d1.batch([])).rejects.toThrow(/does not model batch/);
  });
});
