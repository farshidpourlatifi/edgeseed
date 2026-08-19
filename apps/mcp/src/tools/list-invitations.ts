import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { can, getOrganizationForMember, listPendingInvitations } from "@starter/auth";
import { pageArgs, pageWindow, type PageArgs } from "./pagination";
import { NOT_A_MEMBER, rejectTool, ROLE_NOT_PERMITTED } from "./reject";
import type { ToolContext } from "./index";

/**
 * Mirrors `GET /api/v1/organization/invitations` — pending only, newest first.
 *
 * **Admin and owner only**, through `can(role, "readInvitations")` rather than a
 * role comparison written here: the rows carry addresses nobody else in the
 * organization has seen, and the decision about who may see them lives in
 * `ORG_CAPABILITIES` (#36). A plain member is refused rather than shown an
 * empty list, which is the same answer the API and the members page give.
 */
export function registerListInvitationsTool(server: McpServer, ctx: ToolContext) {
  server.tool(
    "list_invitations",
    "List an organization's pending invitations, newest first. Requires an admin or owner role in that organization",
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

      // Membership before role, because each answer only makes sense once the
      // one before it holds — and because "not a member" must not be
      // distinguishable from "no such organization".
      const membership = await getOrganizationForMember(ctx.db, {
        userId,
        organizationId: args.organizationId,
      });
      if (!membership) return rejectTool(NOT_A_MEMBER);

      if (!can(membership.role, "readInvitations")) return rejectTool(ROLE_NOT_PERMITTED);

      const page = await listPendingInvitations(ctx.db, {
        userId,
        organizationId: args.organizationId,
        limit,
        offset,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ invitations: page.rows, total: page.total }),
          },
        ],
      };
    },
  );
}
