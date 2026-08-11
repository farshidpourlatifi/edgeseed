import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./users";
import { organization } from "./organizations";

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    /**
     * Cascades on purpose, though the invitation arguably belongs to the
     * organization rather than to whoever sent it: set-null is the better
     * semantic but needs a nullable column, and Better Auth's organization
     * plugin expects this one NOT NULL. Deleting an admin therefore voids the
     * invitations they sent — the org can re-issue them. Revisit only if the
     * column becomes nullable upstream (security-audit.md #13).
     */
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Invitation lists, and the org-delete cascade.
    index("invitation_organizationId_idx").on(table.organizationId),
    // Accepting an invitation resolves it by the invitee's address.
    index("invitation_email_idx").on(table.email),
    // The user-delete cascade above.
    index("invitation_inviterId_idx").on(table.inviterId),
  ],
);
