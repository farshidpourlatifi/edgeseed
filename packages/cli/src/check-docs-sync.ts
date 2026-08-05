/**
 * Drift check: every root package.json script must be documented in the
 * README command tables. Fails hard so CI catches undocumented commands.
 */
import { readFileSync } from "node:fs";

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
  const content = readFileSync(file, "utf8");
  const missing = scripts.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    failed = true;
    console.error(`${file} is missing: ${missing.map((m) => `pnpm ${m}`).join(", ")}`);
  }
}

if (failed) {
  console.error("\nDocument the commands above (or add them to IGNORED with a reason).");
  process.exit(1);
}
console.log(`docs-sync ok: ${scripts.length} scripts documented in ${DOC_FILES.join(", ")}`);
