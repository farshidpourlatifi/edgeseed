/**
 * Refuse to release a tag whose version disagrees with the code it names.
 *
 * Runs in `.github/workflows/release.yml` *before* the deploy, because the
 * failure it catches is unfixable afterwards: a Worker reporting one version
 * at `/health` under a GitHub Release named another. `version:bump` writes
 * both `package.json` and `packages/config/src/version.ts`, and the tag is
 * created by hand — so all three are separate chances to disagree.
 *
 * The comparison logic lives in ./lib/release-version so its deny paths are
 * unit- and mutation-tested.
 */
import { readFileSync } from "node:fs";

import {
  parseAppVersion,
  releaseOrderProblem,
  releaseVersionProblems,
} from "./lib/release-version";

// Falls back to the tag that triggered the workflow, so the CI step needs no
// argument plumbing. Any further arguments are the tags already released —
// pass them to get the downgrade check too.
const [tagArg, ...existingTags] = process.argv.slice(2);
const tag = tagArg ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error(
    "Usage: pnpm check:release-version <tag> [already-released-tag...]   (or set GITHUB_REF_NAME)",
  );
  process.exit(1);
}

const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string })
  .version;
const appVersion = parseAppVersion(readFileSync("packages/config/src/version.ts", "utf8"));

const orderProblem = releaseOrderProblem(tag, existingTags);
const problems = [
  ...releaseVersionProblems({ tag, packageVersion, appVersion }),
  ...(orderProblem && existingTags.length > 0 ? [orderProblem] : []),
];

if (problems.length > 0) {
  console.error(`Refusing to release ${tag}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nThe tag must name the commit that carries the bump. Run `pnpm version:bump`,\n" +
      "commit the result, then tag that commit.",
  );
  process.exit(1);
}

console.log(`${tag} matches package.json and APP_VERSION (${packageVersion})`);
