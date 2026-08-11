import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripUnsupportedPragmas } from "./lib/d1-sql";

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/migrations");

const listMigrations = (): string[] => {
  try {
    return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return [];
  }
};

// Only files this run creates are rewritten. An already-applied migration is
// immutable (AGENTS.md concern #10), so a blanket sweep would be wrong even
// though the edit is harmless.
const before = new Set(listMigrations());

console.log("Generating Drizzle migration...");
execSync("pnpm --filter @starter/db exec drizzle-kit generate", {
  stdio: "inherit",
  cwd: process.cwd(),
});

for (const file of listMigrations()) {
  if (before.has(file)) continue;

  const path = join(MIGRATIONS_DIR, file);
  const { sql, removed } = stripUnsupportedPragmas(readFileSync(path, "utf8"));
  if (removed.length === 0) continue;

  writeFileSync(path, sql);
  console.log(
    `\nRewrote ${file} for D1: removed ${removed.length} unsupported ` +
      `${removed.length === 1 ? "statement" : "statements"} (${removed.join(" ")}).\n` +
      "D1 enforces foreign keys and rejects that pragma; the table rebuild does " +
      "not need it. See packages/cli/src/lib/d1-sql.ts.",
  );
}
