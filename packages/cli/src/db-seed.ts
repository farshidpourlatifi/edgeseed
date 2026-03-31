import { execSync } from "node:child_process";

const seedSQL = `
INSERT OR IGNORE INTO user (id, email, emailVerified, name, createdAt, updatedAt)
VALUES ('seed-user-1', 'admin@example.com', 1, 'Admin User', unixepoch(), unixepoch());

INSERT OR IGNORE INTO organization (id, name, slug, createdAt)
VALUES ('seed-org-1', 'Acme Inc', 'acme', unixepoch());

INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
VALUES ('seed-member-1', 'seed-org-1', 'seed-user-1', 'owner', unixepoch());
`;

console.log("Seeding development data...");
execSync(
  `pnpm --filter @starter/web exec wrangler d1 execute starter-db --local --command "${seedSQL.replace(/\n/g, " ")}"`,
  { stdio: "inherit", cwd: process.cwd() },
);
console.log("Seed complete.");
