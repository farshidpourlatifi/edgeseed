/**
 * Makes drizzle-kit's generated SQL safe to apply to D1.
 *
 * Pure and tested because the failure is invisible locally. SQLite cannot
 * `ALTER` a constraint, so every foreign-key change becomes a table rebuild,
 * and drizzle-kit wraps that rebuild in `PRAGMA foreign_keys=OFF` /
 * `...=ON`. **D1 does not support that pragma** — it enforces foreign keys and
 * documents `PRAGMA defer_foreign_keys` as the only lever a query may pull.
 * Local `db:migrate` runs against miniflare's SQLite, which accepts the pragma,
 * so `pnpm verify` goes green and the *remote* migration is what breaks.
 *
 * Stripping it is safe rather than merely expedient: the rebuild drizzle emits
 * is `CREATE __new_x` → `INSERT … SELECT` → `DROP x` → `RENAME`, and every
 * table it rebuilds here is a foreign-key *child* that nothing else references.
 * Nothing in that sequence needs enforcement suspended. drizzle-kit itself only
 * wraps the first rebuild in a multi-table migration and leaves the rest
 * running with enforcement on, which is the same thing this produces.
 *
 * What it does NOT paper over: if the existing rows already violate the new
 * constraints, the `INSERT … SELECT` fails loudly. That is the correct
 * outcome — orphaned rows are the defect, and silently dropping them would
 * destroy data. Check before applying to a real database:
 *
 *     SELECT COUNT(*) FROM member m
 *       LEFT JOIN organization o ON o.id = m.organizationId
 *      WHERE o.id IS NULL;
 */

/** drizzle-kit's statement separator in generated migration files. */
const BREAKPOINT = "--> statement-breakpoint";

/** `PRAGMA foreign_keys = on|off` in any spacing/casing drizzle-kit emits. */
const FOREIGN_KEYS_PRAGMA = /^PRAGMA\s+foreign_keys\s*=\s*(?:on|off)\s*;?$/i;

export interface PragmaStripResult {
  /** The migration SQL with unsupported pragmas removed. */
  sql: string;
  /** Each statement removed, trimmed — for reporting. Empty when nothing matched. */
  removed: string[];
}

/**
 * Removes `PRAGMA foreign_keys=…` statements from a generated migration.
 *
 * Returns the input untouched when there is nothing to strip, so callers can
 * skip rewriting the file.
 */
export function stripUnsupportedPragmas(sql: string): PragmaStripResult {
  const removed: string[] = [];

  const kept = sql.split(BREAKPOINT).filter((statement) => {
    if (!FOREIGN_KEYS_PRAGMA.test(statement.trim())) return true;
    removed.push(statement.trim());
    return false;
  });

  if (removed.length === 0) return { sql, removed };

  // Removing the leading statement leaves the newline that followed its
  // breakpoint, which would otherwise open the file with a blank line.
  return { sql: kept.join(BREAKPOINT).replace(/^\n+/, ""), removed };
}
