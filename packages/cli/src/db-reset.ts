import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { D1_BINDING } from "./lib/d1-binding";

console.log("Resetting local D1 database...");

// Remove local D1 state
const wranglerState = join("apps", "web", ".wrangler");
try {
  rmSync(wranglerState, { recursive: true, force: true });
  console.log("Removed .wrangler state directory.");
} catch {
  // Already clean
}

// Re-apply all migrations. stdin is detached, never inherited: wrangler asks
// "continue?" whenever its stdin and stdout are both terminals, and then waits —
// so run from one by another script (e2e global-setup), this sat on a prompt
// nobody could see. Without a stdin to read, wrangler proceeds by itself.
console.log("Re-applying migrations...");
execSync(`pnpm --filter @starter/web exec wrangler d1 migrations apply ${D1_BINDING} --local`, {
  stdio: ["ignore", "inherit", "inherit"],
  cwd: process.cwd(),
});
console.log("Database reset complete.");
