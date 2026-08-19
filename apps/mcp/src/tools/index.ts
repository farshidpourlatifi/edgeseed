import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@starter/db";
import { registerHealthTool } from "./health";
import { registerListInvitationsTool } from "./list-invitations";
import { registerListMembersTool } from "./list-members";
import { registerListOrganizationsTool } from "./list-organizations";
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

/**
 * Register all MCP tools — add one per public API route.
 *
 * **Open/closed, and the reason this is a list of calls rather than a loop over
 * a registry**: a new tool is a new file plus a line here, and nothing above is
 * edited. The organization tools are read-only by design (#39) — every write
 * this repo performs on membership goes through Better Auth's own endpoints so
 * the rate limiter and `ORGANIZATION_ROLES` stay the single enforcement point,
 * and a mutating tool has to answer that before it is added.
 */
export function registerTools(server: McpServer, ctx: ToolContext) {
  registerHealthTool(server, ctx);
  registerWhoamiTool(server, ctx);
  registerListOrganizationsTool(server, ctx);
  registerListMembersTool(server, ctx);
  registerListInvitationsTool(server, ctx);
}
