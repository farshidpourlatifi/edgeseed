import { execSync } from "node:child_process";

console.log("Generating Drizzle migration...");
execSync("pnpm --filter @starter/db exec drizzle-kit generate", {
  stdio: "inherit",
  cwd: process.cwd(),
});
