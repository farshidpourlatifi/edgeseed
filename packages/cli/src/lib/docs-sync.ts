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
