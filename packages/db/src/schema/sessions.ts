import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";
import { user } from "./users";

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  activeOrganizationId: text("activeOrganizationId"),
  ...timestamps,
});
