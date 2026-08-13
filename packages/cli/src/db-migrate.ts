import { execSync } from "node:child_process";
import { D1_BINDING } from "./lib/d1-binding";
import { resolveDbTarget } from "./lib/db-target";

const target = resolveDbTarget(process.argv);

// The flag is always passed explicitly. Omitting it does NOT mean remote —
// wrangler defaults to local, so an implicit remote silently migrates the
// developer's own database and reports success.
console.log(`Applying migrations to the ${target.label} database (binding ${D1_BINDING})...`);
execSync(
  `pnpm --filter @starter/web exec wrangler d1 migrations apply ${D1_BINDING} ${target.flag}`,
  { stdio: "inherit", cwd: process.cwd() },
);
