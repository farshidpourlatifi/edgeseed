import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./index";

/**
 * Reports the principal behind the current access token.
 *
 * Deliberately reads from `ctx.user` (the OAuth grant) rather than any
 * client-supplied argument — a tool must never take the caller's word for who
 * they are.
 */
export function registerWhoamiTool(server: McpServer, ctx: ToolContext) {
  server.tool(
    "whoami",
    "Show the account this MCP connection is authenticated as",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ userId: ctx.user.userId, email: ctx.user.email }),
        },
      ],
    }),
  );
}
