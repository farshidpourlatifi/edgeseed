import { and, desc, eq, isNull } from "drizzle-orm";
import { apiToken, type Database } from "@starter/db";
import { generateApiToken } from "./api-token";

/** Safe-to-display view of a token. Never carries the plaintext or the hash. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

const DAY_MS = 86_400_000;

function toSummary(row: ApiTokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Active (non-revoked) tokens for a user, newest first. */
export async function listApiTokens(db: Database, userId: string): Promise<ApiTokenSummary[]> {
  const rows = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.createdAt));

  return rows.map(toSummary);
}

/**
 * Mint and persist a token.
 *
 * The returned `token` is the only time the plaintext exists outside the
 * caller's clipboard — the row stores just its SHA-256 hash.
 */
export async function createApiToken(
  db: Database,
  input: {
    userId: string;
    organizationId: string | null;
    name: string;
    expiresInDays?: number;
    now?: Date;
  },
): Promise<ApiTokenSummary & { token: string }> {
  const { token, tokenHash, prefix } = await generateApiToken();
  const now = input.now ?? new Date();

  const row = {
    id: crypto.randomUUID(),
    userId: input.userId,
    organizationId: input.organizationId,
    name: input.name,
    tokenHash,
    prefix,
    lastUsedAt: null,
    expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * DAY_MS) : null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(apiToken).values(row);
  return { ...toSummary(row), token };
}

/**
 * Revoke one of `userId`'s tokens. Returns false if it does not exist, is
 * already revoked, or belongs to someone else.
 *
 * Scoping the update by `userId` (not just `id`) is what stops one user
 * revoking another's token by guessing an id; the indistinguishable `false`
 * also avoids confirming that an id exists.
 */
export async function revokeApiToken(
  db: Database,
  input: { userId: string; id: string; now?: Date },
): Promise<boolean> {
  const revoked = await db
    .update(apiToken)
    .set({ revokedAt: input.now ?? new Date() })
    .where(
      and(eq(apiToken.id, input.id), eq(apiToken.userId, input.userId), isNull(apiToken.revokedAt)),
    )
    .returning({ id: apiToken.id });

  return revoked.length > 0;
}
