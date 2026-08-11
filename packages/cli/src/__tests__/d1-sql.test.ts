import { describe, it, expect } from "vitest";
import { stripUnsupportedPragmas } from "../lib/d1-sql";

const BREAKPOINT = "--> statement-breakpoint";

describe("stripUnsupportedPragmas", () => {
  it("removes a leading foreign_keys=OFF without leaving a blank first line", () => {
    const sql = [
      `PRAGMA foreign_keys=OFF;${BREAKPOINT}`,
      "CREATE TABLE `__new_member` (`id` text);",
    ].join("\n");

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual(["PRAGMA foreign_keys=OFF;"]);
    expect(result.sql).toBe("CREATE TABLE `__new_member` (`id` text);");
  });

  it("collapses every blank line the removed statement left behind", () => {
    const sql = `PRAGMA foreign_keys=OFF;${BREAKPOINT}\n\nCREATE TABLE \`t\` (\`id\` text);`;

    expect(stripUnsupportedPragmas(sql).sql).toBe("CREATE TABLE `t` (`id` text);");
  });

  it("removes a foreign_keys=ON between two statements, preserving their separator and newlines", () => {
    const sql = [
      `ALTER TABLE \`__new_member\` RENAME TO \`member\`;${BREAKPOINT}`,
      `PRAGMA foreign_keys=ON;${BREAKPOINT}`,
      "CREATE INDEX `member_userId_idx` ON `member` (`userId`);",
    ].join("\n");

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual(["PRAGMA foreign_keys=ON;"]);
    // Exact, not `toContain`: the statements either side must keep the
    // breakpoint *and* the newline between them, or the next statement is
    // welded onto the marker and stops being a statement at all.
    expect(result.sql).toBe(
      `ALTER TABLE \`__new_member\` RENAME TO \`member\`;${BREAKPOINT}\nCREATE INDEX \`member_userId_idx\` ON \`member\` (\`userId\`);`,
    );
  });

  it("matches regardless of casing and spacing", () => {
    const sql = `pragma   foreign_keys   =   Off ;${BREAKPOINT}\nSELECT 1;`;

    expect(stripUnsupportedPragmas(sql).removed).toHaveLength(1);
  });

  it("matches without a trailing semicolon", () => {
    const sql = `PRAGMA foreign_keys=OFF${BREAKPOINT}\nSELECT 1;`;

    expect(stripUnsupportedPragmas(sql).removed).toEqual(["PRAGMA foreign_keys=OFF"]);
  });

  // Deny path: pragmas D1 *does* support must survive, or the stripper becomes
  // a silent correctness bug of its own.
  it("leaves defer_foreign_keys alone", () => {
    const sql = `PRAGMA defer_foreign_keys=ON;${BREAKPOINT}\nSELECT 1;`;

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual([]);
    expect(result.sql).toBe(sql);
  });

  // The dangerous one. Removal is whole-statement, so matching a *prefix* would
  // take the real SQL sharing that statement down with the pragma.
  it("keeps a statement that starts with the pragma but carries more SQL after it", () => {
    const sql = "PRAGMA foreign_keys=OFF; DROP TABLE `user`;";

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual([]);
    expect(result.sql).toBe(sql);
  });

  it("keeps a pragma that is not at the start of its statement", () => {
    const sql = "-- restore enforcement\nPRAGMA foreign_keys=ON;";

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual([]);
    expect(result.sql).toBe(sql);
  });

  it("does not touch a statement that merely mentions foreign_keys", () => {
    const sql = "CREATE TABLE `t` (`foreign_keys` text);";

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual([]);
    expect(result.sql).toBe(sql);
  });

  it("returns the input byte-for-byte when there is nothing to strip", () => {
    // Leading newline included on purpose: with nothing removed the input is
    // handed back untouched rather than re-joined and trimmed.
    const sql = `\nCREATE TABLE \`t\` (\`id\` text);${BREAKPOINT}\nCREATE INDEX \`i\` ON \`t\` (\`id\`);`;

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual([]);
    expect(result.sql).toBe(sql);
  });

  it("removes every occurrence when a migration rebuilds several tables", () => {
    const sql = [
      `PRAGMA foreign_keys=OFF;${BREAKPOINT}`,
      `DROP TABLE \`a\`;${BREAKPOINT}`,
      `PRAGMA foreign_keys=ON;${BREAKPOINT}`,
      "DROP TABLE `b`;",
    ].join("\n");

    const result = stripUnsupportedPragmas(sql);

    expect(result.removed).toEqual(["PRAGMA foreign_keys=OFF;", "PRAGMA foreign_keys=ON;"]);
    expect(result.sql).toBe(`DROP TABLE \`a\`;${BREAKPOINT}\nDROP TABLE \`b\`;`);
  });
});
