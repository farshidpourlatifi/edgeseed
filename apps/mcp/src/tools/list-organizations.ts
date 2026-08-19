import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { can, listOrganizationsForMember, ORG_CAPABILITIES } from "@starter/auth";
import type { OrgCapability } from "@starter/auth";
import { pageArgs, pageWindow, type PageArgs } from "./pagination";
import type { ToolContext } from "./index";

/**
 * The capability flags, derived from the matrix rather than listed.
 *
 * The same derivation `apps/web/server/api-organization.ts` performs, and for
 * the same reason: adding an entry to `ORG_CAPABILITIES` has to reach every
 * surface without an edit here. Two matrices that agree today disagree after
 * the first change.
 */
const CAPABILITY_KEYS = Object.keys(ORG_CAPABILITIES) as OrgCapability[];

function capabilitiesFor(role: string): Record<OrgCapability, boolean> {
  return Object.fromEntries(
    CAPABILITY_KEYS.map((capability) => [capability, can(role, capability)]),
  ) as Record<OrgCapability, boolean>;
}

/**
 * The organizations behind the current access token.
 *
 * **The tool with no target**, and therefore the one a client calls first: MCP
 * is stateless here — there is no "set active organization" — so this is where
 * the ids that `list_members` and `list_invitations` take as arguments come
 * from. Which means a client never has to guess an id, and an id it did not get
 * from here reads as a refusal rather than as a probe that half-works.
 *
 * Scoped by `ctx.user.userId` from the OAuth grant. There is no user argument
 * to supply and nothing here reads one.
 */
export function registerListOrganizationsTool(server: McpServer, ctx: ToolContext) {
  server.tool(
    "list_organizations",
    "List the organizations the authenticated account belongs to, with the caller's role in each and what that role permits",
    pageArgs,
    async (args: Partial<PageArgs> | undefined) => {
      const { limit, offset } = pageWindow(args);

      const page = await listOrganizationsForMember(ctx.db, {
        userId: ctx.user.userId,
        limit,
        offset,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              organizations: page.rows.map((row) => ({
                ...row.organization,
                role: row.role,
                capabilities: capabilitiesFor(row.role),
              })),
              total: page.total,
            }),
          },
        ],
      };
    },
  );
}
