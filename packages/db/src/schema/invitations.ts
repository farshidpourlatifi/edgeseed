import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { user } from "./users";
import { organization } from "./organizations";

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => organization.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("pending"),
  inviterId: text("inviterId")
    .notNull()
    .references(() => user.id),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
