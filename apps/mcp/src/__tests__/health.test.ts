import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION } from "@starter/config/version";
import { registerHealthTool } from "../tools/health";
import type { ToolContext } from "../tools/index";

describe("health_check tool", () => {
  it("registers under the right name and mirrors GET /api/v1/health", async () => {
    const tool = vi.fn();
    const server = { tool } as unknown as McpServer;

    registerHealthTool(server, {} as ToolContext);

    expect(tool).toHaveBeenCalledTimes(1);
    const [name, description, , handler] = tool.mock.calls[0];
    expect(name).toBe("health_check");
    expect(description).toMatch(/health/i);

    const result = await handler();
    expect(JSON.parse(result.content[0].text)).toEqual({
      status: "ok",
      version: APP_VERSION,
    });
  });
});
