import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    ...timestamps,
  },
  (table) => [
    // Every signup, verification click and password reset resolves a token by
    // identifier, and rows are never purged (security-audit.md #12), so this
    // table only grows.
    index("verification_identifier_idx").on(table.identifier),
  ],
);
