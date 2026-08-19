import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORG_CAPABILITIES, PAGE_SIZE } from "@starter/auth";
import { registerListOrganizationsTool } from "../tools/list-organizations";
import type { McpProps, ToolContext } from "../tools/index";
import {
  ANA,
  CAI,
  DIA,
  ORG,
  OTHER_ORG,
  seedOrganizations,
  type Fixture,
} from "./organization-fixture";

/**
 * `list_organizations` against a real database.
 *
 * The tool takes **no target** — the whole tenancy question is whether the
 * `WHERE` clause behind it is keyed on the grant — so a mocked store would test
 * nothing that matters here. `@starter/auth` is left unmocked for the same
 * reason `can()` is left unmocked in the API suite: the capability flags this
 * reports have to be the real matrix, or a change to `ORG_CAPABILITIES` would
 * leave the suite green while MCP stopped agreeing with the members page.
 */

let fixture: Fixture;

beforeEach(() => {
  fixture = seedOrganizations();
});

afterEach(() => {
  fixture.close();
});

function register(user: McpProps, ctx?: ToolContext) {
  const tool = vi.fn();
  registerListOrganizationsTool({ tool } as unknown as McpServer, ctx ?? fixture.contextFor(user));
  return {
    name: tool.mock.calls[0][0] as string,
    shape: tool.mock.calls[0][2] as z.ZodRawShape,
    call: (args?: unknown) => tool.mock.calls[0][3](args),
  };
}

async function payload(user: McpProps, args?: unknown) {
  const result = await register(user).call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

describe("list_organizations tool", () => {
  it("registers under the right name", () => {
    expect(register(ANA).name).toBe("list_organizations");
  });

  it("returns each organization with the caller's role and capabilities", async () => {
    await expect(payload(ANA)).resolves.toEqual({
      organizations: [
        {
          id: ORG,
          name: "Trading",
          slug: "trading",
          logo: "https://cdn.test/logo.png",
          createdAt: "2026-08-19T00:00:00.000Z",
          role: "owner",
          capabilities: {
            invite: true,
            revokeInvitation: true,
            readInvitations: true,
            changeRole: true,
            removeMember: true,
            leave: true,
          },
        },
      ],
      total: 1,
    });
  });

  /*
   * Derived from the matrix, never listed: adding a capability to
   * `ORG_CAPABILITIES` has to reach this payload with no edit in the tool. A
   * test asserting a hand-written key list would pass while the new capability
   * went unreported.
   */
  it("reports exactly the capabilities the matrix declares", async () => {
    const { organizations } = await payload(ANA);

    expect(Object.keys(organizations[0].capabilities).sort()).toEqual(
      Object.keys(ORG_CAPABILITIES).sort(),
    );
  });

  it("reports a plain member's narrower capabilities from the real matrix", async () => {
    const { organizations } = await payload(CAI);

    expect(organizations[0].capabilities).toEqual({
      invite: false,
      revokeInvitation: false,
      readInvitations: false,
      changeRole: false,
      removeMember: false,
      leave: true,
    });
  });

  // The only tenancy guarantee this tool has: the rows come from `member` rows
  // owned by the grant, so another tenant's organization is simply not in them.
  it("scopes the list to ctx.user.userId", async () => {
    await expect(payload(DIA)).resolves.toMatchObject({
      organizations: [expect.objectContaining({ id: OTHER_ORG, role: "owner" })],
      total: 1,
    });
  });

  it("returns nothing for an account with no memberships", async () => {
    const stranger = { userId: "user_nobody", email: "nobody@example.com" };

    await expect(payload(stranger)).resolves.toEqual({ organizations: [], total: 0 });
  });

  /*
   * Identity comes from the OAuth grant. A tool that let an argument choose
   * whose organizations to read would be the whole audit #8 rule undone, and
   * unlike `whoami` the damage here is another tenant's data rather than a
   * misreported name.
   */
  it("ignores a caller-supplied userId or email", async () => {
    await expect(
      payload(DIA, { userId: ANA.userId, email: ANA.email, organizationId: ORG }),
    ).resolves.toMatchObject({
      organizations: [expect.objectContaining({ id: OTHER_ORG })],
      total: 1,
    });
  });

  describe("pagination", () => {
    beforeEach(() => {
      // 24 more, so the default page is full and a second page exists.
      fixture.giveOrganizations(ANA, 24, "org_extra");
    });

    it("defaults to the page size every other surface reads under", async () => {
      const { organizations, total } = await payload(ANA);

      expect(organizations).toHaveLength(PAGE_SIZE);
      expect(total).toBe(25);
    });

    it("reads the window it is given, and the total stays unfiltered", async () => {
      const { organizations, total } = await payload(ANA, { limit: 5, offset: 20 });

      expect(organizations).toHaveLength(5);
      expect(total).toBe(25);
    });

    it("pages without repeating or skipping a row", async () => {
      const first = await payload(ANA, { limit: PAGE_SIZE, offset: 0 });
      const second = await payload(ANA, { limit: PAGE_SIZE, offset: PAGE_SIZE });
      const ids = [...first.organizations, ...second.organizations].map(
        (organization: { id: string }) => organization.id,
      );

      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
    });
  });

  /*
   * The bound is a cost decision — D1 bills rows scanned — so it is refused at
   * the schema rather than clamped in the handler: a client asking for 100 rows
   * is told no, not handed 20 and left believing that was all of them.
   */
  describe("input schema", () => {
    const parse = (args: unknown) => z.object(register(ANA).shape).safeParse(args);

    it("defaults limit and offset", () => {
      expect(parse({})).toMatchObject({ success: true, data: { limit: PAGE_SIZE, offset: 0 } });
    });

    const badWindows: Array<[Record<string, unknown>, string]> = [
      [{ limit: PAGE_SIZE + 1 }, "above the cap"],
      [{ limit: 0 }, "zero rows"],
      [{ limit: -1 }, "negative limit"],
      [{ limit: 2.5 }, "fractional limit"],
      [{ offset: -1 }, "negative offset"],
      [{ limit: "all" }, "not a number"],
    ];

    it.each(badWindows)("refuses %j (%s)", (args) => {
      expect(parse(args).success).toBe(false);
    });

    it("declares no identity parameter", () => {
      expect(Object.keys(register(ANA).shape).sort()).toEqual(["limit", "offset"]);
    });
  });
});
