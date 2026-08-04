import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@starter/db";
import { registerHealthTool } from "./health";
import { registerWhoamiTool } from "./whoami";

/**
 * The authenticated principal, minted by the OAuth consent flow in
 * `auth-app.ts` and handed to the Agent by `OAuthProvider` via `ctx.props`.
 */
export interface McpProps extends Record<string, unknown> {
  userId: string;
  email: string;
}

export interface ToolContext {
  db: Database;
  /**
   * Always present: `OAuthProvider` rejects the request before the Agent runs,
   * so there is no unauthenticated path to a tool. Scope every query by this.
   */
  user: McpProps;
}

/** Register all MCP tools — add one per public API route */
export function registerTools(server: McpServer, ctx: ToolContext) {
  registerHealthTool(server, ctx);
  registerWhoamiTool(server, ctx);
}
