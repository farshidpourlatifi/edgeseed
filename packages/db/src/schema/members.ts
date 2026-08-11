import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./users";
import { organization } from "./organizations";

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Read on every dashboard navigation: Better Auth's `listOrganizations`
    // filters membership by user (costs-and-limits.md — the hot missing index).
    // Also what keeps the user-delete cascade from scanning the table.
    index("member_userId_idx").on(table.userId),
    // Member lists, and the org-delete cascade.
    index("member_organizationId_idx").on(table.organizationId),
  ],
);
