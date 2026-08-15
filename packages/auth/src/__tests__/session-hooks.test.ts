import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@starter/db";
import { resolveMembership } from "../helpers/org-store";
import { sessionDatabaseHooks } from "../session-hooks";

vi.mock("../helpers/org-store", () => ({ resolveMembership: vi.fn() }));

/**
 * Better Auth writes `session.activeOrganizationId` in create-organization,
 * accept-invitation and set-active, and nowhere else — so without this hook a
 * returning member signs in with no active organization at all, while the
 * sidebar switcher shows their first one anyway. The failure is silent in every
 * direction, which is why the hook's shape is asserted rather than assumed to
 * be wired.
 */

const db = {} as Database;
const lookup = vi.mocked(resolveMembership);

/** The slice of a session row the hook reads. */
const session = { userId: "user_1" } as Parameters<
  NonNullable<NonNullable<ReturnType<typeof sessionDatabaseHooks>>["session"]>["create"]
>[0];

function before() {
  const hook = sessionDatabaseHooks(db)?.session?.create?.before;
  if (!hook) throw new Error("no session create hook — nothing sets the active organization");
  return hook;
}

beforeEach(() => {
  lookup.mockReset();
});

describe("sessionDatabaseHooks", () => {
  it("is registered on session creation", () => {
    expect(before()).toBeInstanceOf(Function);
  });

  it("starts the session in the caller's own organization", async () => {
    lookup.mockResolvedValue({ organizationId: "org_1", role: "member" });

    await expect(before()(session, undefined as never)).resolves.toEqual({
      data: { activeOrganizationId: "org_1" },
    });
  });

  it("asks for the caller's default organization, never a caller-supplied one", async () => {
    lookup.mockResolvedValue({ organizationId: "org_1", role: "member" });

    await before()(session, undefined as never);

    expect(lookup).toHaveBeenCalledWith(db, { userId: "user_1", organizationId: null });
  });

  /**
   * The deny path, and the reason the hook returns nothing rather than
   * `{ data: { activeOrganizationId: undefined } }`: `createWithHooks` spreads
   * whatever `data` it is handed over the row, so a returned key is a key
   * written — and writing `undefined` into a column with a foreign key is a
   * different bug on every adapter.
   */
  it("writes nothing for an account that belongs to no organization", async () => {
    lookup.mockResolvedValue(null);

    await expect(before()(session, undefined as never)).resolves.toBeUndefined();
  });
});
