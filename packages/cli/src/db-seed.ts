import { execSync } from "node:child_process";
import { hashPassword } from "better-auth/crypto";

/**
 * Local dev credentials. Safe to commit: this script is `--local` only (see the
 * wrangler invocation below), so these never reach a deployed database.
 *
 * The `account` row is the part that matters. Seeding a `user` alone — which is
 * what this did until now — produces a row that can never sign in, because
 * Better Auth keeps the password on `account`, not `user`.
 */
const SEED_EMAIL = "admin@example.com";
const SEED_PASSWORD = "dev-password-123";

// Better Auth's own hasher, so the stored form always matches what sign-in
// verifies against — even if it changes algorithm in a future release.
const passwordHash = await hashPassword(SEED_PASSWORD);

const seedSQL = `
INSERT OR IGNORE INTO user (id, email, emailVerified, name, createdAt, updatedAt)
VALUES ('seed-user-1', '${SEED_EMAIL}', 1, 'Admin User', unixepoch(), unixepoch());

INSERT OR IGNORE INTO account (id, userId, providerId, accountId, password, createdAt, updatedAt)
VALUES ('seed-account-1', 'seed-user-1', 'credential', 'seed-user-1', '${passwordHash}', unixepoch(), unixepoch());

INSERT OR IGNORE INTO organization (id, name, slug, createdAt)
VALUES ('seed-org-1', 'Acme Inc', 'acme', unixepoch());

INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
VALUES ('seed-member-1', 'seed-org-1', 'seed-user-1', 'owner', unixepoch());
`;

console.log("Seeding development data...");
execSync(
  `pnpm --filter @starter/web exec wrangler d1 execute edgeseed-db --local --command "${seedSQL.replace(/\n/g, " ")}"`,
  { stdio: "inherit", cwd: process.cwd() },
);
console.log(`Seed complete. Sign in as ${SEED_EMAIL} / ${SEED_PASSWORD}`);
