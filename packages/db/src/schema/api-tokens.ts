import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { timestamps } from "../helpers/timestamps";
import { user } from "./users";
import { organization } from "./organizations";

/**
 * Long-lived bearer tokens for non-interactive clients (the CLI, CI).
 *
 * Only the SHA-256 hash is stored — the plaintext is shown once at creation and
 * is unrecoverable afterwards. That is deliberately stricter than the OAuth and
 * verification tokens flagged in docs/security-audit.md #12; do not copy their
 * plaintext pattern here.
 */
export const apiToken = sqliteTable(
  "apiToken",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Optional tenancy scope. Null means the token acts outside any organization. */
    organizationId: text("organizationId").references(() => organization.id, {
      onDelete: "cascade",
    }),
    /** Human label, e.g. "CI deploy". Not unique — users reuse names. */
    name: text("name").notNull(),
    /** SHA-256 hex of the token. Lookups go through this, so no comparison is needed. */
    tokenHash: text("tokenHash").notNull().unique(),
    /** Leading characters, for display in a token list. Not a secret. */
    prefix: text("prefix").notNull(),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp" }),
    /** Null means the token never expires. */
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    /** Set instead of deleting, so an audit trail survives revocation. */
    revokedAt: integer("revokedAt", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    // The settings token list, plus the user-delete cascade.
    index("apiToken_userId_idx").on(table.userId),
    // The org-delete cascade — deleting an organization revokes tokens scoped to it.
    index("apiToken_organizationId_idx").on(table.organizationId),
  ],
);
