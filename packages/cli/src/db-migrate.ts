import { execSync } from "node:child_process";

const isRemote = process.argv.includes("--remote");
const flag = isRemote ? "" : "--local";

console.log(`Applying migrations (${isRemote ? "remote" : "local"})...`);
execSync(`pnpm --filter @starter/web exec wrangler d1 migrations apply starter-db ${flag}`, {
  stdio: "inherit",
  cwd: process.cwd(),
});
