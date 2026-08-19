import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ToolContext } from "../tools/index";

/**
 * The registry itself.
 *
 * A tool written, tested and never registered is invisible in production and
 * green in its own suite — the one failure the per-tool files cannot catch,
 * because each of them calls its `register…` function directly.
 */

const TOOLS = ["health_check", "whoami", "list_organizations", "list_members", "list_invitations"];

function registeredNames() {
  const tool = vi.fn();
  const ctx = { db: {}, user: { userId: "u1", email: "a@b.c" } } as unknown as ToolContext;

  registerTools({ tool } as unknown as McpServer, ctx);

  return tool.mock.calls.map((call) => call[0] as string);
}

describe("registerTools", () => {
  it("registers every tool, and only those", () => {
    expect(registeredNames().sort()).toEqual([...TOOLS].sort());
  });

  it.each(TOOLS)("registers %s", (name) => {
    expect(registeredNames()).toContain(name);
  });

  // `check:docs-sync` reads these names out of the source and fails the PR if
  // the README never mentions one, so a duplicate would document one tool and
  // ship two under the same name.
  it("registers no name twice", () => {
    const names = registeredNames();

    expect(new Set(names).size).toBe(names.length);
  });
});
