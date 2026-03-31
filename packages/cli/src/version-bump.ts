import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

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

console.log(`Bumped version to ${newVersion}`);

// Create git tag
execSync(`git tag v${newVersion}`, { stdio: "inherit" });
console.log(`Created tag v${newVersion}`);
