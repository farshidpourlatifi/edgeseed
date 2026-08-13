import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";
import { user } from "./users";

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("providerId").notNull(),
    accountId: text("accountId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    // The social sign-in lookup: resolve an incoming provider identity to a
    // local account before deciding to link or create.
    index("account_providerId_accountId_idx").on(table.providerId, table.accountId),
    // Listing a user's linked providers, plus the user-delete cascade.
    index("account_userId_idx").on(table.userId),
  ],
);
