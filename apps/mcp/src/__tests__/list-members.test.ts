import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PAGE_SIZE } from "@starter/auth";
import { registerListMembersTool } from "../tools/list-members";
import { NOT_A_MEMBER } from "../tools/reject";
import type { McpProps } from "../tools/index";
import {
  ANA,
  BEN,
  CAI,
  DIA,
  NO_SUCH_ORG,
  ORG,
  OTHER_ORG,
  seedOrganizations,
  type Fixture,
} from "./organization-fixture";

/**
 * `list_members` against a real database, with a second tenant beside it.
 *
 * The acceptance criterion of #39 lives here: a tool that takes an organization
 * id as a **target** must verify membership server-side before reading. The
 * store is unmocked on purpose — a mock returning `null` proves the tool
 * branches, not that a real foreign id fails to match.
 */

let fixture: Fixture;

beforeEach(() => {
  fixture = seedOrganizations();
});

afterEach(() => {
  fixture.close();
});

function register(user: McpProps) {
  const tool = vi.fn();
  registerListMembersTool({ tool } as unknown as McpServer, fixture.contextFor(user));
  return {
    name: tool.mock.calls[0][0] as string,
    shape: tool.mock.calls[0][2] as z.ZodRawShape,
    call: (args?: unknown) => tool.mock.calls[0][3](args),
  };
}

const body = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

async function payload(user: McpProps, args: unknown) {
  const result = await register(user).call(args);
  expect(result.isError).toBeFalsy();
  return body(result);
}

describe("list_members tool", () => {
  it("registers under the right name", () => {
    expect(register(ANA).name).toBe("list_members");
  });

  // Parity with GET /api/v1/organization/members: `{ members, total }`, the
  // person joined onto the membership row, oldest first.
  it("mirrors the API's shape, fields and order", async () => {
    await expect(payload(ANA, { organizationId: ORG })).resolves.toEqual({
      members: [
        {
          id: "mem_ana",
          userId: ANA.userId,
          name: "Ana",
          email: ANA.email,
          role: "owner",
          createdAt: "2026-08-19T00:00:00.000Z",
        },
        {
          id: "mem_ben",
          userId: BEN.userId,
          name: "Ben",
          email: BEN.email,
          role: "admin",
          createdAt: "2026-08-19T00:00:01.000Z",
        },
        {
          id: "mem_cai",
          userId: CAI.userId,
          name: "Cai",
          email: CAI.email,
          role: "member",
          createdAt: "2026-08-19T00:00:02.000Z",
        },
      ],
      total: 3,
    });
  });

  // Reading the roster is not an admin power — every member of an organization
  // sees who else is in it, exactly as the members page renders it.
  it.each([
    ["owner", ANA],
    ["admin", BEN],
    ["member", CAI],
  ])("lets a %s read the roster", async (_role, user) => {
    await expect(payload(user, { organizationId: ORG })).resolves.toMatchObject({ total: 3 });
  });

  /* ------------------------------- deny paths ------------------------------ */

  /**
   * The issue's required acceptance test: a target the grant has nothing to do
   * with. `OTHER_ORG` is real and populated, so this is a genuine cross-tenant
   * read being refused rather than an id that matches no row.
   */
  it("rejects an organization the caller does not belong to", async () => {
    const result = await register(ANA).call({ organizationId: OTHER_ORG });

    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: NOT_A_MEMBER });
  });

  it("leaks no rows in the refusal", async () => {
    const result = await register(ANA).call({ organizationId: OTHER_ORG });

    expect(result.content[0].text).not.toContain(DIA.email);
    expect(result.content[0].text).not.toContain("mem_dia");
  });

  /*
   * Indistinguishable from the case above, deliberately: the store resolves the
   * target inside the caller's own memberships, so both come back `null`. Two
   * messages would turn an id into an oracle for probing another tenant.
   */
  it("answers a nonexistent organization exactly as it answers a foreign one", async () => {
    const foreign = await register(ANA).call({ organizationId: OTHER_ORG });
    const absent = await register(ANA).call({ organizationId: NO_SUCH_ORG });

    expect(absent).toEqual(foreign);
  });

  it("rejects an account with no memberships at all", async () => {
    const stranger = { userId: "user_nobody", email: "nobody@example.com" };
    const result = await register(stranger).call({ organizationId: ORG });

    expect(result.isError).toBe(true);
  });

  /*
   * Identity is the grant's, never the argument's. Ana's own id in the body
   * must not turn Dia's call into Ana's read.
   */
  it("ignores a caller-supplied userId or email", async () => {
    const result = await register(DIA).call({
      organizationId: ORG,
      userId: ANA.userId,
      email: ANA.email,
    });

    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: NOT_A_MEMBER });
  });

  /* ------------------------------- pagination ------------------------------ */

  describe("pagination", () => {
    it("defaults to the page size every other surface reads under", async () => {
      const shape = z.object(register(ANA).shape);

      expect(shape.safeParse({ organizationId: ORG })).toMatchObject({
        success: true,
        data: { limit: PAGE_SIZE, offset: 0 },
      });
    });

    it("reads the window it is given, and the total stays unfiltered", async () => {
      await expect(payload(ANA, { organizationId: ORG, limit: 1, offset: 1 })).resolves.toEqual({
        members: [expect.objectContaining({ id: "mem_ben" })],
        total: 3,
      });
    });

    const badWindows: Array<[Record<string, unknown>, string]> = [
      [{ limit: PAGE_SIZE + 1 }, "above the cap"],
      [{ limit: 0 }, "zero rows"],
      [{ offset: -1 }, "negative offset"],
      [{ limit: 2.5 }, "fractional limit"],
    ];

    it.each(badWindows)("refuses %j at the schema (%s)", (args) => {
      const shape = z.object(register(ANA).shape);

      expect(shape.safeParse({ organizationId: ORG, ...args }).success).toBe(false);
    });
  });

  describe("input schema", () => {
    it("takes a target and a window, and nothing that names a person", () => {
      expect(Object.keys(register(ANA).shape).sort()).toEqual([
        "limit",
        "offset",
        "organizationId",
      ]);
    });

    it("requires a non-empty organizationId", () => {
      const shape = z.object(register(ANA).shape);

      expect(shape.safeParse({}).success).toBe(false);
      expect(shape.safeParse({ organizationId: "" }).success).toBe(false);
    });
  });
});
