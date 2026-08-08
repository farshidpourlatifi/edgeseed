/**
 * Drift checks, failing hard so CI catches them:
 * 1. Every root package.json script must be documented in the README command
 *    tables.
 * 2. Each app's .dev.vars.example must stay in sync with the env schema in
 *    packages/config — the examples are the key-name reference agents audit
 *    real .dev.vars files against, so a stale example defeats the check.
 *
 * The comparison logic lives in ./lib/docs-sync so its deny paths are unit-
 * and mutation-tested.
 */
import { readFileSync } from "node:fs";

import {
  compareEnvExample,
  exampleKeys,
  schemaBlockKeys,
  undocumentedScripts,
} from "./lib/docs-sync";

const IGNORED = new Set(["prepare"]);

// AGENTS.md, not CLAUDE.md: AGENTS.md is the canonical instruction file and
// CLAUDE.md is a thin `@AGENTS.md` import, so checking CLAUDE.md would only ever
// assert against a pointer.
const DOC_FILES = ["README.md", "docs/README.md", "AGENTS.md"];

const scripts = Object.keys(
  (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts,
).filter((s) => !IGNORED.has(s));

let failed = false;
for (const file of DOC_FILES) {
  const missing = undocumentedScripts(scripts, readFileSync(file, "utf8"));
  if (missing.length > 0) {
    failed = true;
    console.error(`${file} is missing: ${missing.map((m) => `pnpm ${m}`).join(", ")}`);
  }
}

// --- Check 2: .dev.vars.example vs the env schema ---

// Bindings and wrangler.jsonc-managed vars — real, but never set via .dev.vars.
// The RATE_LIMIT_* entries are `[[ratelimits]]` bindings (audit #4); wrangler
// provides them locally too, so there is nothing for a developer to fill in.
const NON_DEV_VARS = new Set([
  "DB",
  "ENVIRONMENT",
  "RATE_LIMIT_DEFAULT",
  "RATE_LIMIT_CREDENTIALS",
  "RATE_LIMIT_MAIL",
]);

const ENV_SCHEMA_FILE = "packages/config/src/env.ts";
// The schemas diverge (mcp has no BETTER_AUTH_URL), so each example is
// compared against shared + its own app block.
const EXAMPLES = [
  { file: "apps/web/.dev.vars.example", schema: "webEnvSchema" },
  { file: "apps/mcp/.dev.vars.example", schema: "mcpEnvSchema" },
];

const envSource = readFileSync(ENV_SCHEMA_FILE, "utf8");
const sharedKeys = schemaBlockKeys(envSource, "sharedEnvSchema");
const mirrored: string[] = [];

for (const { file, schema } of EXAMPLES) {
  const keys = [...sharedKeys, ...schemaBlockKeys(envSource, schema)].filter(
    (k) => !NON_DEV_VARS.has(k),
  );
  const drift = compareEnvExample(keys, exampleKeys(readFileSync(file, "utf8")));
  if (drift.missing.length > 0) {
    failed = true;
    console.error(`${file} is missing schema keys: ${drift.missing.join(", ")}`);
  }
  if (drift.unknown.length > 0) {
    failed = true;
    console.error(
      `${file} declares keys absent from ${ENV_SCHEMA_FILE}: ${drift.unknown.join(", ")}`,
    );
  }
  mirrored.push(`${schema}: ${keys.length}`);
}

if (failed) {
  console.error(
    "\nFix the drift above: document the commands (or add to IGNORED with a reason)," +
      " and keep .dev.vars.example matching the env schema.",
  );
  process.exit(1);
}
console.log(
  `docs-sync ok: ${scripts.length} scripts documented in ${DOC_FILES.join(", ")}; ` +
    `env keys mirrored (${mirrored.join(", ")})`,
);
