import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * A `D1Database` binding backed by a real in-memory SQLite, with this repo's
 * own migrations applied.
 *
 * Small but real, for the same reason `fake-kv.ts` stores what it is given: the
 * org-scoped reads in `@starter/auth` are guarded by `WHERE` clauses, and a
 * mocked store returning `null` because a test said so is not evidence that a
 * real id from another tenant reads as absent. Anything asserting tenancy needs
 * a database that can answer wrongly.
 *
 * **The schema comes from `packages/db/migrations`, never from a fixture.** A
 * hand-written `CREATE TABLE` here would drift from the real schema silently,
 * and drift is the whole failure this double exists to catch. Applying the
 * migrations in order also means a downstream product's own migrations are
 * applied too, so its tests see its schema rather than the starter's.
 *
 * What it does **not** model — reach for e2e against real D1 rather than
 * assuming these work: `batch()` (drizzle only uses it for explicit
 * `db.batch`), transactions and savepoints, `meta` counters (`rows_read`,
 * `changes`), D1's row-size and statement limits, and the network latency that
 * makes an N+1 read expensive. It also does not enforce D1's refusal of
 * `PRAGMA foreign_keys` — SQLite accepts it, so a migration carrying one still
 * passes here and fails remotely (AGENTS.md, "Schema changes").
 */
export interface FakeD1 {
  /** The underlying SQLite handle, for seeding rows and asserting on them. */
  readonly sqlite: DatabaseSync;
  /** Insert one row, columns inferred from the object's keys. */
  insert(table: string, row: Record<string, string | number | null>): void;
  /** Release the handle. Call it in `afterEach`, or the process keeps them. */
  close(): void;
}

/**
 * A `Date` as this schema stores it.
 *
 * Drizzle's `integer({ mode: "timestamp" })` is **seconds**, not milliseconds —
 * `timestamp_ms` is the other mode — so a row seeded with `Date.now()` reads
 * back as a date fifty thousand years out, which sorts and compares fine and is
 * therefore invisible until an expiry assertion fails for no reason.
 */
export function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

/**
 * Where the migrations live, relative to this file.
 *
 * A sibling-package path rather than an import, because `@starter/testing` has
 * **zero runtime workspace dependencies, permanently** — importing `@starter/db`
 * to reach them would rebuild the `config → cli → config` cycle this package was
 * split out to break.
 */
// `fileURLToPath` is handed the string, never a `new URL(...)`: consumers
// typecheck under `@cloudflare/workers-types` + DOM, whose `URL` is a different
// type from `node:url`'s and is rejected here.
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/** Every migration's statements, in the order drizzle-kit wrote them. */
function migrationStatements(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      readFileSync(`${dir}/${name}`, "utf8")
        // drizzle-kit's own separator — statements are not `;`-splittable,
        // since a `CREATE TABLE` body contains none but a `DEFAULT ';'` could.
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

/**
 * The `D1PreparedStatement` surface drizzle's D1 driver actually calls.
 *
 * `raw()` is the hot one: a `select` with fields goes through `values()`, which
 * expects arrays in column order rather than objects. `all()` and `run()` are
 * the fieldless paths, and `first()` is there for callers that reach past
 * drizzle.
 */
function prepareOn(sqlite: DatabaseSync, sql: string) {
  const bound = (params: unknown[]) => {
    const statement = () => {
      const prepared = sqlite.prepare(sql);
      // Timestamps are stored as integers and drizzle maps them with
      // `new Date(value)`, which a BigInt would throw on.
      prepared.setReadBigInts(false);
      return prepared;
    };
    const args = params as never[];

    return {
      all: async () => ({ results: statement().all(...args), success: true, meta: {} }),
      raw: async () =>
        (statement().all(...args) as Record<string, unknown>[]).map((row) => Object.values(row)),
      run: async () => {
        statement().run(...args);
        return { results: [], success: true, meta: {} };
      },
      first: async () => statement().get(...args) ?? null,
    };
  };

  return { ...bound([]), bind: (...params: unknown[]) => bound(params) };
}

/**
 * A D1 binding over a fresh in-memory database.
 *
 * Pass it to `createFakeEnv({ DB: ... })`, or to `createDb()` directly.
 */
export function createFakeD1(): D1Database & FakeD1 {
  const sqlite = new DatabaseSync(":memory:");
  for (const statement of migrationStatements(MIGRATIONS_DIR)) sqlite.exec(statement);

  const fake = {
    sqlite,
    prepare: (sql: string) => prepareOn(sqlite, sql),
    batch: async () => {
      throw new Error("createFakeD1 does not model batch() — see the doc comment");
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    insert(table: string, row: Record<string, string | number | null>) {
      const columns = Object.keys(row);
      sqlite
        .prepare(
          `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) ` +
            `VALUES (${columns.map(() => "?").join(",")})`,
        ) // `never[]` because node:sqlite's binding type is narrower than the
        // union a row literal produces; every value here is a SQLite primitive.
        .run(...(Object.values(row) as never[]));
    },
    close: () => sqlite.close(),
  };

  // The real binding carries `dump`, `withSession` and the `meta` counters that
  // the doc comment above says are absent. Substitutable on every path drizzle
  // exercises, which is the contract these tests depend on.
  return fake as unknown as D1Database & FakeD1;
}
