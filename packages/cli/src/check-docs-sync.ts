/**
 * Drift checks, failing hard so CI catches them:
 * 1. Every root package.json script must be documented in the README command
 *    tables.
 * 2. Each app's .dev.vars.example must stay in sync with the env schema in
 *    packages/config — the examples are the key-name reference agents audit
 *    real .dev.vars files against, so a stale example defeats the check.
 * 3. Relative links in the public docs must resolve, so a moved file cannot
 *    quietly turn a documented path into a 404.
 * 4. Every MCP tool and every API path the code exposes must be named in the
 *    README, so the public capability claims cannot drift below what ships.
 *
 * These run on every PR and in the weekly cron. They are the mechanical half of
 * keeping docs true; the judgement half is the sweep in docs/housekeeping.md.
 *
 * The comparison logic lives in ./lib/docs-sync so its deny paths are unit-
 * and mutation-tested.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import {
  brokenRelativeLinks,
  compareEnvExample,
  exampleKeys,
  mcpToolNames,
  schemaBlockKeys,
  undocumentedNames,
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
  "OAUTH_KV",
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

// --- Check 3: relative links in the public docs must resolve ---

// The docs a first-time visitor or adopter actually walks. Per-package
// CLAUDE.md files are deliberately out: they are read in place by an agent
// already in that directory, and they cross-reference each other far more
// loosely than the published surface does.
//
// `recursive` matters: without it this saw only top-level docs/*.md, so
// docs/adr/*.md went unchecked while AGENTS.md and CONTRIBUTING.md both
// advertised the check as covering the public docs — and the README walks a
// reader straight into docs/adr/002-observability.md.
const LINKED_DOCS = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ...readdirSync("docs", { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("docs", f)),
];

let linksChecked = 0;
for (const file of LINKED_DOCS) {
  const content = readFileSync(file, "utf8");
  // Targets are written relative to the document, so resolve from its own
  // directory — `./docs/mcp.md` in README.md and `./mcp.md` in docs/README.md
  // name the same file.
  const broken = brokenRelativeLinks(content, (target) =>
    existsSync(normalize(join(dirname(file), target))),
  );
  linksChecked += 1;
  if (broken.length > 0) {
    failed = true;
    console.error(`${file} links to missing paths: ${broken.join(", ")}`);
  }
}

// --- Check 4: the README must name every MCP tool and API path that ships ---

const readme = readFileSync("README.md", "utf8");

const TOOLS_DIR = "apps/mcp/src/tools";
const toolSources = readdirSync(TOOLS_DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts" && !f.includes("__tests__"))
  .map((f) => readFileSync(join(TOOLS_DIR, f), "utf8"));
const toolNames = mcpToolNames(toolSources);

// A discovery-based check has to fail when it discovers nothing, or it reports
// success for the wrong reason. An empty inventory yields an empty
// undocumented list, so without this floor a renamed registration API, a moved
// directory, or an emptied one would all print "0 MCP tools documented" and
// exit 0. The Worker ships two tools; zero means the scan broke, not that the
// product lost its MCP surface.
if (toolNames.length === 0) {
  failed = true;
  console.error(
    `No MCP tools found in ${TOOLS_DIR} — the scan is broken, not the surface.` +
      " Check the registration call it matches in lib/docs-sync.ts.",
  );
}

const undocumentedTools = undocumentedNames(toolNames, readme);
if (undocumentedTools.length > 0) {
  failed = true;
  console.error(`README.md does not mention MCP tools: ${undocumentedTools.join(", ")}`);
}

// The generated spec, not the route source: it is the published contract, and
// it is already regenerated and diffed by the api:spec drift check.
const apiPaths = Object.keys(
  (JSON.parse(readFileSync("docs/api/openapi.json", "utf8")) as { paths: Record<string, unknown> })
    .paths,
);
const undocumentedPaths = undocumentedNames(apiPaths, readme);
if (undocumentedPaths.length > 0) {
  failed = true;
  console.error(`README.md does not mention API paths: ${undocumentedPaths.join(", ")}`);
}

if (failed) {
  console.error(
    "\nFix the drift above: document the commands (or add to IGNORED with a reason)," +
      " keep .dev.vars.example matching the env schema, repair the links, and make the" +
      " README name every tool and path that ships.",
  );
  process.exit(1);
}
console.log(
  `docs-sync ok: ${scripts.length} scripts documented in ${DOC_FILES.join(", ")}; ` +
    `env keys mirrored (${mirrored.join(", ")}); ` +
    `links resolved in ${linksChecked} docs; ` +
    `${toolNames.length} MCP tools and ${apiPaths.length} API paths documented`,
);
