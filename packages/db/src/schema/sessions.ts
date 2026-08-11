import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";
import { user } from "./users";
import { organization } from "./organizations";

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    /**
     * Nulled when the organization goes away. Without the constraint a deleted
     * org leaves a ghost id here, and `principal.ts` hands that id to
     * `/api/v1` as the caller's `organizationId` — harmless while nothing
     * authorizes on it, load-bearing as soon as something does.
     */
    activeOrganizationId: text("activeOrganizationId").references(() => organization.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  // Deliberately no index on `activeOrganizationId`. It would only serve the
  // set-null above, and organization deletion is rare while this table takes a
  // write on every sign-in — the scan is the cheaper side of that trade.
  (table) => [
    // Session listing and revoke-all, plus the user-delete cascade.
    index("session_userId_idx").on(table.userId),
  ],
);
