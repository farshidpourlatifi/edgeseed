import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const level = (process.argv[2] || "patch") as "major" | "minor" | "patch";

if (!["major", "minor", "patch"].includes(level)) {
  console.error("Usage: version:bump [major|minor|patch]");
  process.exit(1);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

const newVersion = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[level];

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Also update the hardcoded version in packages/config/src/version.ts
const versionTsPath = "packages/config/src/version.ts";
const versionTs = readFileSync(versionTsPath, "utf-8");
writeFileSync(
  versionTsPath,
  versionTs.replace(/APP_VERSION = "[^"]+"/, `APP_VERSION = "${newVersion}"`),
);

// `docs/api/openapi.json` stamps `info.version` from `APP_VERSION`, so the bump
// made it stale and the `drift` CI job failed on the next PR opened — not on the
// release itself, which is what made v0.1.1's miss easy to walk past. Regenerate
// here so the spec rides in the release commit. A separate process on purpose:
// `api-spec.ts` reads `APP_VERSION` through an import, and this one has already
// been resolved with the old value in *this* process.
execSync("pnpm api:spec", { stdio: "inherit", cwd: process.cwd() });

console.log(`Bumped version to ${newVersion}`);

// Deliberately does not tag. At this point the bump is an *uncommitted*
// working-tree change, so a tag created here would point at the commit before
// it — and pushing that tag is what deploys, so it would ship the previous
// APP_VERSION under this version's name. `check:release-version` refuses that,
// which is a confusing way to learn the tag was made one commit too early.
//
// Annotated (`-a`) on purpose: `git push --follow-tags` ignores lightweight
// tags, so a lightweight one looks pushed and never triggers the release.
console.log(`
Next — the tag must name the commit that carries this bump:

  git commit -am "chore(release): v${newVersion}"
  git push origin HEAD
  git tag -a v${newVersion} -m "v${newVersion}"
  git push origin v${newVersion}     # this is what deploys and cuts the release
`);
