import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrganizationForMember, listOrganizationMembers } from "@starter/auth";
import { pageArgs, pageWindow, type PageArgs } from "./pagination";
import { NOT_A_MEMBER, rejectTool } from "./reject";
import type { ToolContext } from "./index";

/** Mirrors `GET /api/v1/organization/members` — same fields, same order, same bound. */
export function registerListMembersTool(server: McpServer, ctx: ToolContext) {
  server.tool(
    "list_members",
    "List the members of an organization the authenticated account belongs to, oldest first",
    {
      organizationId: z
        .string()
        .min(1)
        .describe("Organization to read, from list_organizations. A target, not a credential."),
      ...pageArgs,
    },
    async (args: { organizationId: string } & Partial<PageArgs>) => {
      const { limit, offset } = pageWindow(args);
      const userId = ctx.user.userId;

      // The membership check is explicit and comes first, even though
      // `listOrganizationMembers` scopes itself too. An organization id arriving
      // in a tool argument proves nothing, and a caller who is not in it must
      // hear a refusal rather than read an empty list as "no members".
      const membership = await getOrganizationForMember(ctx.db, {
        userId,
        organizationId: args.organizationId,
      });
      if (!membership) return rejectTool(NOT_A_MEMBER);

      const page = await listOrganizationMembers(ctx.db, {
        userId,
        organizationId: args.organizationId,
        limit,
        offset,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ members: page.rows, total: page.total }),
          },
        ],
      };
    },
  );
}
