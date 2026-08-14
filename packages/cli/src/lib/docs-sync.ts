/**
 * Pure logic for `pnpm check:docs-sync`.
 *
 * Kept separate from the script body so the deny paths — an undocumented
 * script, a schema key missing from an example, an example key the schema
 * does not know — are unit- and mutation-testable without touching live
 * repo files (which `init:product` rewrites in downstream clones).
 */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Root scripts whose full `pnpm <script>` invocation never appears in the
 * doc. Substring matching is not enough: `pnpm test:e2e` must not count as
 * documenting `test`, and prose like "the build output" must not count as
 * documenting `build` — hence the required `pnpm ` prefix and end boundary.
 */
export function undocumentedScripts(scripts: string[], docContent: string): string[] {
  return scripts.filter(
    (s) => !new RegExp(`pnpm ${escapeRegExp(s)}(?![A-Za-z0-9:_-])`).test(docContent),
  );
}

/**
 * Keys of one named schema declaration in env.ts source — from
 * `const <blockName>` to the line closing the statement, matching the
 * 2-space-indented object keys. Compose shared + app blocks for a Worker's
 * full key set; the schemas diverge (mcp has no BETTER_AUTH_URL).
 *
 * The block ends at a `;` in **column zero** — the `});` that closes the
 * declaration — rather than the first `;` anywhere. Scanning for the first one
 * truncated the block at a semicolon inside a comment, and the report that
 * followed said every key below it was "absent from env.ts" while they sat
 * there in plain sight. The keys themselves are indented by two spaces, so no
 * key can hide behind this.
 */
export function schemaBlockKeys(envSource: string, blockName: string): string[] {
  const start = envSource.indexOf(`const ${blockName}`);
  if (start === -1) return [];
  const rest = envSource.slice(start);
  const end = /^\S.*;\s*$/m.exec(rest);
  const block = end ? rest.slice(0, end.index + end[0].length) : rest;
  return [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/**
 * Keys declared in a .dev.vars.example — live (`KEY=`) or commented
 * placeholder (`# KEY=value`), the form templates use for keys whose schema
 * rejects an empty string.
 */
export function exampleKeys(exampleContent: string): Set<string> {
  return new Set([...exampleContent.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

/** Drift between the schema's keys and an example file's keys. */
export function compareEnvExample(
  schema: string[],
  example: ReadonlySet<string>,
): { missing: string[]; unknown: string[] } {
  return {
    missing: schema.filter((k) => !example.has(k)),
    unknown: [...example].filter((k) => !schema.includes(k)),
  };
}

/**
 * Relative link and image targets in a markdown document, as written.
 *
 * Only local targets are returned: absolute URLs (`https:`, `mailto:`) point
 * outward and are not this repo's to keep working, and a bare `#anchor` is
 * in-page. An anchor or query suffix is stripped, so `./docs/a.md#b` resolves
 * as `./docs/a.md` — the file is what can go missing, and verifying heading
 * anchors would mean parsing every target's headings for a far rarer failure.
 *
 * Angle-bracket destinations (`[x](<./a b.md>)`) are unwrapped, and titles
 * (`[x](./a.md "t")`) are dropped, because both are valid markdown a doc may
 * grow at any time.
 */
export function relativeLinkTargets(docContent: string): string[] {
  const targets: string[] = [];
  for (const [, raw] of docContent.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = raw.trim();
    target = target.startsWith("<") ? target.slice(1, target.indexOf(">")) : target.split(/\s+/)[0];
    target = target.split("#")[0].split("?")[0].trim();
    if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    targets.push(decodeURIComponent(target));
  }
  return targets;
}

/**
 * Relative links in `docContent` whose target does not exist.
 *
 * `exists` is injected rather than reaching for `node:fs` so the deny path is
 * testable without a fixture tree — and so this stays pure, like everything
 * else in this module.
 */
export function brokenRelativeLinks(
  docContent: string,
  exists: (target: string) => boolean,
): string[] {
  return [...new Set(relativeLinkTargets(docContent))].filter((t) => !exists(t));
}

/**
 * Tool names registered with an `McpServer`, read from the tools' source.
 *
 * The registration string is the name a client sees, and it lives apart from
 * the `registerXTool` function name — so this matches `server.tool("<name>"`
 * rather than the export, which is what would drift.
 */
export function mcpToolNames(toolSources: string[]): string[] {
  return toolSources.flatMap((src) =>
    [...src.matchAll(/server\.tool\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)].map((m) => m[1]),
  );
}

/**
 * Names in `expected` that the doc never mentions.
 *
 * Shared by the MCP-tool and API-path checks: both are "the code exposes this,
 * so the public doc has to say so". Matching is a plain substring, because a
 * path appears as `/tokens/{id}` in one sentence and inside a table cell in
 * another — anchoring it to a syntax would fail on the doc's own prose.
 */
export function undocumentedNames(expected: string[], docContent: string): string[] {
  return [...new Set(expected)].filter((name) => !docContent.includes(name));
}
