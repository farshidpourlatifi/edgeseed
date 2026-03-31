import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ...timestamps,
});
