import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./index";

/** MCP tool matching GET /api/v1/health */
export function registerHealthTool(server: McpServer, _ctx: ToolContext) {
  server.tool("health_check", "Check the health status of the API", {}, async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ status: "ok", version: "0.1.0" }),
      },
    ],
  }));
}
