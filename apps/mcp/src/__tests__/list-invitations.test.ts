import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { can, ORG_CAPABILITIES, PAGE_SIZE, ROLES } from "@starter/auth";
import { registerListInvitationsTool } from "../tools/list-invitations";
import { NOT_A_MEMBER, ROLE_NOT_PERMITTED } from "../tools/reject";
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
 * `list_invitations` against a real database.
 *
 * Two guards stacked, and the order matters: membership first, so "not a
 * member" cannot be told apart from "no such organization", then the role. The
 * matrix is the **real** `ORG_CAPABILITIES` — mocking `can()` here would let the
 * tool disagree with the API and the members page while the suite stayed green.
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
  registerListInvitationsTool({ tool } as unknown as McpServer, fixture.contextFor(user));
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

/** Who the matrix actually grants the capability to, rather than a copy of it. */
const READERS: Array<[string, McpProps]> = [
  ["owner", ANA],
  ["admin", BEN],
  ["member", CAI],
];

describe("list_invitations tool", () => {
  it("registers under the right name", () => {
    expect(register(ANA).name).toBe("list_invitations");
  });

  /*
   * Parity with GET /api/v1/organization/invitations: `{ invitations, total }`,
   * newest first, and **pending as the product means it** — the expired row and
   * the accepted one are absent, because `status = 'pending'` alone would show
   * links that cannot be accepted.
   */
  it("mirrors the API's shape and its pending filter", async () => {
    await expect(payload(ANA, { organizationId: ORG })).resolves.toEqual({
      invitations: [
        {
          id: "inv_fresh",
          email: "fin@example.com",
          role: "member",
          expiresAt: "2026-08-26T00:00:00.000Z",
          createdAt: "2026-08-19T00:00:02.000Z",
        },
        {
          id: "inv_older",
          email: "gus@example.com",
          role: "admin",
          expiresAt: "2026-08-26T00:00:00.000Z",
          createdAt: "2026-08-19T00:00:01.000Z",
        },
      ],
      total: 2,
    });
  });

  /* ------------------------------ the matrix ------------------------------ */

  /**
   * Driven from `can()` rather than from a list written here, so a change to
   * `ORG_CAPABILITIES.readInvitations` moves this test with it instead of
   * leaving it asserting the old policy.
   */
  it.each(READERS)("answers a %s exactly as the matrix says", async (role, user) => {
    const result = await register(user).call({ organizationId: ORG });

    if (can(role, "readInvitations")) {
      expect(result.isError).toBeFalsy();
      expect(body(result).total).toBe(2);
    } else {
      expect(result.isError).toBe(true);
      expect(body(result)).toEqual({ error: ROLE_NOT_PERMITTED });
    }
  });

  it("permits every role the matrix grants readInvitations", async () => {
    const permitted = READERS.filter(([role]) => can(role, "readInvitations")).map(
      ([role]) => role,
    );

    expect(permitted).toEqual([ROLES.owner, ROLES.admin]);
  });

  it("is guarded by readInvitations, not by a rank written here", () => {
    expect(ORG_CAPABILITIES.readInvitations).toBe(ROLES.admin);
  });

  /* ------------------------------- deny paths ------------------------------ */

  /*
   * Not an empty list — a refusal. The rows carry addresses nobody else in the
   * organization has seen, which is why `readInvitations` is a capability of its
   * own (#36).
   */
  it("rejects a plain member, and returns none of the addresses", async () => {
    const result = await register(CAI).call({ organizationId: ORG });

    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: ROLE_NOT_PERMITTED });
    expect(result.content[0].text).not.toContain("fin@example.com");
  });

  /** The issue's required acceptance test, for the second target-taking tool. */
  it("rejects an organization the caller does not belong to", async () => {
    const result = await register(ANA).call({ organizationId: OTHER_ORG });

    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: NOT_A_MEMBER });
    expect(result.content[0].text).not.toContain("jan@example.com");
  });

  /*
   * An owner of another tenant hears the membership refusal, never the role
   * one — otherwise "your role does not permit this" would confirm the
   * organization exists and that they are outside it, which is two facts more
   * than a stranger should get.
   */
  it("refuses a foreign owner on membership, not on role", async () => {
    const result = await register(DIA).call({ organizationId: ORG });

    expect(body(result)).toEqual({ error: NOT_A_MEMBER });
  });

  it("answers a nonexistent organization exactly as it answers a foreign one", async () => {
    const foreign = await register(ANA).call({ organizationId: OTHER_ORG });
    const absent = await register(ANA).call({ organizationId: NO_SUCH_ORG });

    expect(absent).toEqual(foreign);
  });

  it("ignores a caller-supplied userId or email", async () => {
    const result = await register(CAI).call({
      organizationId: ORG,
      userId: ANA.userId,
      email: ANA.email,
      role: ROLES.owner,
    });

    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: ROLE_NOT_PERMITTED });
  });

  /* ------------------------------- pagination ------------------------------ */

  describe("pagination", () => {
    it("defaults to the page size every other surface reads under", () => {
      const shape = z.object(register(ANA).shape);

      expect(shape.safeParse({ organizationId: ORG })).toMatchObject({
        success: true,
        data: { limit: PAGE_SIZE, offset: 0 },
      });
    });

    it("reads the window it is given, and the total stays unfiltered", async () => {
      await expect(payload(ANA, { organizationId: ORG, limit: 1, offset: 1 })).resolves.toEqual({
        invitations: [expect.objectContaining({ id: "inv_older" })],
        total: 2,
      });
    });

    const badWindows: Array<[Record<string, unknown>, string]> = [
      [{ limit: PAGE_SIZE + 1 }, "above the cap"],
      [{ limit: 0 }, "zero rows"],
      [{ offset: -1 }, "negative offset"],
    ];

    it.each(badWindows)("refuses %j at the schema (%s)", (args) => {
      const shape = z.object(register(ANA).shape);

      expect(shape.safeParse({ organizationId: ORG, ...args }).success).toBe(false);
    });
  });

  it("takes a target and a window, and nothing that names a person", () => {
    expect(Object.keys(register(ANA).shape).sort()).toEqual(["limit", "offset", "organizationId"]);
  });
});
