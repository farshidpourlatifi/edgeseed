import { execSync } from "node:child_process";

export default function globalSetup() {
  console.log("Resetting database for e2e tests...");
  execSync("pnpm db:reset", { stdio: "inherit" });
}
