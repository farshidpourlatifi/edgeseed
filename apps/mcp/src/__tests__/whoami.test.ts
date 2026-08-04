import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoamiTool } from "../tools/whoami";
import type { ToolContext } from "../tools/index";

function contextFor(user: { userId: string; email: string }) {
  return { db: {}, user } as unknown as ToolContext;
}

describe("whoami tool", () => {
  it("registers under the right name", () => {
    const tool = vi.fn();
    registerWhoamiTool(
      { tool } as unknown as McpServer,
      contextFor({ userId: "u1", email: "a@b.c" }),
    );

    expect(tool).toHaveBeenCalledTimes(1);
    expect(tool.mock.calls[0][0]).toBe("whoami");
  });

  it("reports the principal from the OAuth grant", async () => {
    const tool = vi.fn();
    registerWhoamiTool(
      { tool } as unknown as McpServer,
      contextFor({ userId: "user_123", email: "probe@example.com" }),
    );

    const handler = tool.mock.calls[0][3];
    const result = await handler();

    expect(JSON.parse(result.content[0].text)).toEqual({
      userId: "user_123",
      email: "probe@example.com",
    });
  });

  // A tool must never take the caller's word for who they are — the identity
  // comes from the token's grant, never from tool arguments.
  it("ignores any caller-supplied identity", async () => {
    const tool = vi.fn();
    registerWhoamiTool(
      { tool } as unknown as McpServer,
      contextFor({ userId: "real_user", email: "real@example.com" }),
    );

    const handler = tool.mock.calls[0][3];
    const result = await handler({ userId: "attacker", email: "attacker@evil.test" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      userId: "real_user",
      email: "real@example.com",
    });
  });

  it("declares no input parameters", () => {
    const tool = vi.fn();
    registerWhoamiTool(
      { tool } as unknown as McpServer,
      contextFor({ userId: "u1", email: "a@b.c" }),
    );

    expect(tool.mock.calls[0][2]).toEqual({});
  });
});
