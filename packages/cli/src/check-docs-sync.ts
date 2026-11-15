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
 * 5. `pnpm verify` and ci.yml must run the same pnpm commands, so the gate
 *    cannot pass what CI then refuses, or the reverse.
 * 6. Every Playwright container tag in a workflow must name the version
 *    package.json pins.
 *
 * These run inside `pnpm verify`, on every PR and in the weekly cron. They are the mechanical half of
 * keeping docs true; the judgement half is the sweep in docs/housekeeping.md.
 *
 * The comparison logic lives in ./lib/docs-sync and ./lib/ci-sync so its deny
 * paths are unit- and mutation-tested.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  brokenRelativeLinks,
  compareEnvExample,
  exampleKeys,
  expandImports,
  mcpToolNames,
  schemaBlockKeys,
  undocumentedNames,
  undocumentedScripts,
} from "./lib/docs-sync";
import {
  gateCiDrift,
  gateCommands,
  playwrightImageProblems,
  playwrightImageVersions,
  pnpmCommandsRun,
} from "./lib/ci-sync";
import { NON_DEV_VARS } from "./lib/dev-vars";

const IGNORED = new Set(["prepare"]);

// AGENTS.md, not CLAUDE.md: AGENTS.md is the canonical instruction file and
// CLAUDE.md is a thin `@AGENTS.md` import, so checking CLAUDE.md would only ever
// assert against a pointer. The same reasoning one level further: a file
// AGENTS.md imports is part of what an agent reads as AGENTS.md, so its text
// counts for it.
const DOC_FILES = ["README.md", "docs/README.md", "AGENTS.md"];

// An agent file's `@path` line is how it pulls another file in. GitHub renders
// the other two docs, where such a line is plain text — following it there
// would count a command a reader cannot see.
const IMPORTING_DOCS = new Set(["AGENTS.md"]);

/** The text of an existing file; `null` for a directory or a missing path. */
const readRepoFile = (path: string): string | null =>
  statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : null;

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const scripts = Object.keys(pkg.scripts).filter((s) => !IGNORED.has(s));

let failed = false;
const docLabels: string[] = [];
for (const file of DOC_FILES) {
  const raw = readFileSync(file, "utf8");
  const expanded = IMPORTING_DOCS.has(file)
    ? expandImports(raw, file, readRepoFile)
    : { content: raw, imported: [], missing: [] };
  if (expanded.missing.length > 0) {
    failed = true;
    console.error(`${file} imports missing files: ${expanded.missing.join(", ")}`);
  }
  docLabels.push(
    expanded.imported.length > 0 ? `${file} (+ ${expanded.imported.join(", ")})` : file,
  );
  const missing = undocumentedScripts(scripts, expanded.content);
  if (missing.length > 0) {
    failed = true;
    console.error(`${file} is missing: ${missing.map((m) => `pnpm ${m}`).join(", ")}`);
  }
}

// --- Check 2: .dev.vars.example vs the env schema ---

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
  // `resolveDocTarget` does the path work — relative to the document, or to the
  // repo root for a leading `/`, and refusing anything that climbs out of the
  // tree. It hands back a repo-relative path, so all that is left here is
  // asking the filesystem.
  const broken = brokenRelativeLinks(content, file, existsSync);
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

// --- Checks 5 and 6: the CI workflows against the gate and package.json ---

const WORKFLOWS_DIR = ".github/workflows";
const CI_WORKFLOW = join(WORKFLOWS_DIR, "ci.yml");
const GATE_SCRIPT = "verify";
// What ci.yml may run that the gate does not. `db:migrate` prepares the e2e
// database before Playwright starts: setup, not a check. Locally, e2e's
// global-setup resets the database itself.
const CI_ONLY = new Set(["db:migrate"]);

let ciSummary = `; no ${CI_WORKFLOW}, CI checks skipped`;
if (existsSync(CI_WORKFLOW)) {
  // Check 5. The gate's one non-pnpm step, the gitleaks scan, is the `scan`
  // job in gitleaks.yml and is outside this comparison.
  const ci = pnpmCommandsRun(readFileSync(CI_WORKFLOW, "utf8"));
  const gate = gateCommands(pkg.scripts, GATE_SCRIPT);
  const drift = gateCiDrift(gate, ci, CI_ONLY);
  const named = (commands: string[]) => commands.map((c) => `pnpm ${c}`).join(", ");
  // Same floor as the MCP tool scan above: finding nothing means the scan
  // broke, and an empty list would otherwise agree with nothing to compare.
  if (ci.length === 0) {
    failed = true;
    console.error(
      `No pnpm commands found in ${CI_WORKFLOW} — the scan is broken, not the workflow.`,
    );
  }
  if (drift.ciOnly.length > 0) {
    failed = true;
    console.error(
      `ci.yml runs commands \`pnpm ${GATE_SCRIPT}\` never reaches: ${named(drift.ciOnly)}`,
    );
  }
  if (drift.gateOnly.length > 0) {
    failed = true;
    console.error(
      `\`pnpm ${GATE_SCRIPT}\` runs commands ci.yml never runs: ${named(drift.gateOnly)}`,
    );
  }

  // Check 6. One fact, two files: the e2e job runs Playwright's container
  // image, and its tag has to name the version installed from package.json. A
  // mismatch fails e2e with "Executable doesn't exist", which reads as a broken
  // test run rather than a stale tag — so it is caught here, by name, instead.
  //
  // Every workflow, not just ci.yml — release.yml runs the same image, and a
  // tag that drifted only there would surface for the first time during a
  // release, which is the worst moment to learn it.
  //
  // Workflows that do not use the image at all pass: this runs in a clone's
  // gate too, and a clone may run Playwright without the container.
  const workflowSources = readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => readFileSync(join(WORKFLOWS_DIR, f), "utf8"));
  const pinned = pkg.devDependencies?.["@playwright/test"];
  for (const problem of playwrightImageProblems(pinned, workflowSources)) {
    failed = true;
    console.error(problem);
  }

  ciSummary =
    `; gate and ci.yml run the same ${gate.length} pnpm commands; ` +
    (playwrightImageVersions(workflowSources).length > 0
      ? `Playwright image tags match ${pinned}`
      : "no Playwright image in workflows");
}

if (failed) {
  console.error(
    "\nFix the drift above: document the commands (or add to IGNORED with a reason)," +
      " restore or remove an AGENTS.md import whose file is gone," +
      " keep .dev.vars.example matching the env schema, repair the links, make the" +
      " README name every tool and path that ships, add a check to both `pnpm verify`" +
      " and ci.yml or to neither, and keep the Playwright image tags on the version" +
      " package.json pins.",
  );
  process.exit(1);
}
console.log(
  `docs-sync ok: ${scripts.length} scripts documented in ${docLabels.join(", ")}; ` +
    `env keys mirrored (${mirrored.join(", ")}); ` +
    `links resolved in ${linksChecked} docs; ` +
    `${toolNames.length} MCP tools and ${apiPaths.length} API paths documented` +
    ciSummary,
);
