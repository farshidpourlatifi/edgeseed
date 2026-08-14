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
 *
 * Nothing in here may throw. This feeds a CI gate, and a gate that crashes on
 * malformed input reports a stack trace where it owed a finding — so a `%` that
 * is not valid percent-encoding (`./100%-guide.md`) falls back to the raw text,
 * and an unterminated `<` keeps the whole destination rather than silently
 * losing its last character.
 */
export function relativeLinkTargets(docContent: string): string[] {
  const targets: string[] = [];
  for (const [, raw] of docContent.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = raw.trim();
    if (target.startsWith("<")) {
      const close = target.indexOf(">");
      target = close === -1 ? target.slice(1) : target.slice(1, close);
    } else {
      target = target.split(/\s+/)[0];
    }
    target = target.split("#")[0].split("?")[0].trim();
    if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    targets.push(safeDecode(target));
  }
  return targets;
}

/** `decodeURIComponent` that returns its input rather than throwing `URIError`. */
function safeDecode(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
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
 * the `registerXTool` function name — so this matches the registration call
 * rather than the export, which is what would drift.
 *
 * **Both spellings, deliberately.** `server.tool()` is what this repo's two
 * tools use; `server.registerTool()` is the SDK's other current API (present
 * throughout `@modelcontextprotocol/sdk@1.29`'s typings). Matching only the
 * first meant a tool written the other way was invisible here — and because an
 * empty inventory has nothing to report as undocumented, the gate would have
 * passed while asserting nothing. The caller enforces a non-empty floor for the
 * same reason.
 */
export function mcpToolNames(toolSources: string[]): string[] {
  return toolSources.flatMap((src) =>
    [...src.matchAll(/server\.(?:registerTool|tool)\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)].map(
      (m) => m[1],
    ),
  );
}

/**
 * Names in `expected` that the doc never mentions.
 *
 * Shared by the MCP-tool and API-path checks: both are "the code exposes this,
 * so the public doc has to say so". A name may appear anywhere in the prose —
 * in a table cell, inside backticks, mid-sentence — so this is a substring
 * match rather than a syntax.
 *
 * **But it ends at a boundary**, exactly as `undocumentedScripts` does above,
 * and for the same reason: a plain `includes` counted `/tokens` as documented
 * whenever `/tokens/{id}` appeared, so dropping the collection route from the
 * README would have left this gate green while the docs lost a shipped route.
 * A trailing `/`, word character or `-` means the doc is talking about
 * something longer.
 */
export function undocumentedNames(expected: string[], docContent: string): string[] {
  return [...new Set(expected)].filter(
    (name) => !new RegExp(`${escapeRegExp(name)}(?![A-Za-z0-9_:/-])`).test(docContent),
  );
}
