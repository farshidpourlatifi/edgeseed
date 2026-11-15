/**
 * Pure logic for the two `pnpm check:docs-sync` checks that read the CI
 * workflows: the gate and `ci.yml` run the same `pnpm` commands, and every
 * Playwright container tag names the version `package.json` pins.
 *
 * Nothing in here may throw, for the reason given in ./docs-sync: this feeds a
 * gate, and a gate that crashes reports a stack trace where it owed a finding.
 */

const NAME = "[A-Za-z][A-Za-z0-9:_-]*";

// Everything after `pnpm` up to the next shell separator: one invocation.
const RUN_IN_WORKFLOW = /(?<![\w/.-])pnpm[ \t]+([^\s&|;][^&|;]*)/g;
const NAMED = new RegExp(`^(?:run\\s+)?(${NAME})`);
const RUN_IN_SCRIPT = new RegExp(`^pnpm\\s+(?:run\\s+)?(${NAME})(?=\\s|$)`);

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * The `pnpm` commands a workflow runs, by name: `pnpm install
 * --frozen-lockfile` is `install`, `pnpm api:spec --check` is `api:spec`.
 *
 * A comment or a step's `name:` may mention a command without running it, so
 * both are skipped. The lookbehind keeps `pnpm/action-setup` and a path ending
 * in `pnpm` out; requiring an argument keeps `cache: pnpm` out.
 *
 * An invocation that does not start with a command name — `pnpm -s db:seed`,
 * `pnpm --filter x run y`, `pnpm "$CMD"` — is returned whole rather than
 * dropped. Reading the name out of it would mean knowing which flags take a
 * value, and a filtered command is not the root script of that name anyway.
 * Returned whole it matches nothing the gate runs, so the comparison reports
 * it; dropped, CI could run a command the gate never sees and still compare
 * equal.
 */
export function pnpmCommandsRun(workflowSource: string): string[] {
  const commands: string[] = [];
  for (const raw of workflowSource.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || /^(?:-\s*)?name:/.test(line)) continue;
    for (const match of line.matchAll(RUN_IN_WORKFLOW)) {
      const invocation = match[1].trim();
      commands.push(NAMED.exec(invocation)?.[1] ?? invocation);
    }
  }
  return unique(commands);
}

/**
 * The commands a root script ends up running, with aggregates expanded.
 *
 * A script is an aggregate when one of its `&&` / `||` / `;` segments names a
 * root script; it contributes what those segments run rather than itself. A
 * named command that is not a root script (`install`) is pnpm's own and is kept
 * as it is. A segment that names nothing (`gitleaks git --redact`) is not a
 * pnpm command and is outside this list.
 *
 * Anything else is a leaf under its own name — including an `entry` that is not
 * a script at all, so a deleted or renamed gate compares as one unknown command
 * rather than as an empty set that agrees with everything.
 */
export function gateCommands(scripts: Readonly<Record<string, string>>, entry: string): string[] {
  const isScript = (name: string) => Object.hasOwn(scripts, name);
  const expanding = new Set<string>();

  const expand = (name: string): string[] => {
    if (!isScript(name)) return [name];
    const named = scripts[name]
      .split(/&&|\|\||;/)
      .map((segment) => RUN_IN_SCRIPT.exec(segment.trim())?.[1])
      .filter((command) => command !== undefined);
    if (!named.some(isScript)) return [name];
    if (expanding.has(name)) return [];
    expanding.add(name);
    const commands = named.flatMap(expand);
    expanding.delete(name);
    return commands;
  };

  return unique(expand(entry));
}

/**
 * Commands on one side only. `ciOnly` names what CI may run without the gate —
 * setup, not checks. It excuses CI and never the gate: a command the gate runs
 * and CI does not is always reported.
 */
export function gateCiDrift(
  gate: string[],
  ci: string[],
  ciOnly: ReadonlySet<string>,
): { ciOnly: string[]; gateOnly: string[] } {
  return {
    ciOnly: ci.filter((command) => !gate.includes(command) && !ciOnly.has(command)),
    gateOnly: gate.filter((command) => !ci.includes(command)),
  };
}

const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright";
const PLAYWRIGHT_TAG = /mcr\.microsoft\.com\/playwright:v([0-9][0-9.]*)-/g;

/** Versions named by Playwright container image tags (`v1.58.2-noble` is `1.58.2`). */
export function playwrightImageVersions(workflowSources: string[]): string[] {
  return unique(
    workflowSources.flatMap((source) => [...source.matchAll(PLAYWRIGHT_TAG)].map((m) => m[1])),
  );
}

/**
 * One message per way the workflows' Playwright images disagree with the
 * version `package.json` pins.
 *
 * An image whose tag cannot be read (`:latest`, a digest) is a problem too:
 * it is exactly the reference this check cannot vouch for. Workflows that never
 * name the image have nothing to compare, and pass.
 */
export function playwrightImageProblems(
  pinned: string | undefined,
  workflowSources: string[],
): string[] {
  const pin =
    pinned === undefined
      ? "package.json does not pin @playwright/test"
      : `package.json pins @playwright/test ${pinned}`;
  const problems = playwrightImageVersions(workflowSources)
    .filter((version) => version !== pinned)
    .map((version) => `${pin} but a workflow runs the v${version} image`);

  const unreadable = workflowSources.some(
    (source) =>
      source.split(PLAYWRIGHT_IMAGE).length - 1 > [...source.matchAll(PLAYWRIGHT_TAG)].length,
  );
  if (unreadable) {
    problems.push(
      `a workflow names the ${PLAYWRIGHT_IMAGE} image but its tag could not be read as v<version>-<distro>`,
    );
  }
  return problems;
}
