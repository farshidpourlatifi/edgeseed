import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

console.log("Resetting local D1 database...");

// Remove local D1 state
const wranglerState = join("apps", "web", ".wrangler");
try {
  rmSync(wranglerState, { recursive: true, force: true });
  console.log("Removed .wrangler state directory.");
} catch {
  // Already clean
}

// Re-apply all migrations
console.log("Re-applying migrations...");
execSync("pnpm --filter @starter/web exec wrangler d1 migrations apply edgeseed-db --local", {
  stdio: "inherit",
  cwd: process.cwd(),
});
console.log("Database reset complete.");
