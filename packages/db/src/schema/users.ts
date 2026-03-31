import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  ...timestamps,
});
