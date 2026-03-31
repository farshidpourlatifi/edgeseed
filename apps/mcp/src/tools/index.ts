import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@starter/db";
import type { Auth } from "@starter/auth";
import { registerHealthTool } from "./health";

export interface ToolContext {
  db: Database;
  auth: Auth;
}

/** Register all MCP tools — add one per public API route */
export function registerTools(server: McpServer, ctx: ToolContext) {
  registerHealthTool(server, ctx);
}
