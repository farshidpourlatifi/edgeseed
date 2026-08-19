import { vi } from "vitest";
import { createDb } from "@starter/db";
import { createFakeD1, epochSeconds } from "@starter/testing/fake-d1";
import { createFakeEnv } from "@starter/testing/fake-env";
import type { McpProps, ToolContext } from "../tools/index";

/**
 * A real database with two tenants in it, for the organization tools.
 *
 * The tools are guarded by `WHERE` clauses in `@starter/auth`'s stores, and a
 * mocked store returning `null` because a test said so is not evidence that a
 * real id from another tenant reads as absent. The second tenant exists so that
 * every "rejected" assertion below has a genuine, populated organization to be
 * rejected from — refusing an id that matches no row proves much less.
 */

export const ANA: McpProps = { userId: "user_ana", email: "ana@example.com" };
export const BEN: McpProps = { userId: "user_ben", email: "ben@example.com" };
export const CAI: McpProps = { userId: "user_cai", email: "cai@example.com" };
/** Owns `OTHER_ORG` and belongs to nothing else. */
export const DIA: McpProps = { userId: "user_dia", email: "dia@example.com" };

export const ORG = "org_trading";
export const OTHER_ORG = "org_holdings";
/** An id no row carries, so "absent" and "somebody else's" can be compared. */
export const NO_SUCH_ORG = "org_does_not_exist";

const DAY = 24 * 60 * 60 * 1000;
/**
 * The instant this whole fixture is written from — seeded rows, asserted
 * timestamps and the clock the code under test reads, all the same value.
 *
 * **`seedOrganizations` freezes `Date` to it, and `close()` restores the real
 * one.** Not tidiness: `listPendingInvitations` filters on
 * `expiresAt > now ?? new Date()`, so with a live clock the seeded pending
 * invitations below expire on 2026-08-26 and this suite starts failing on a
 * date rather than on a change. Extending `FUTURE` would only move the bomb;
 * freezing removes it, and keeps the fixed ISO strings the assertions use
 * honest at the same time.
 */
const NOW = new Date("2026-08-19T00:00:00.000Z");
export const FUTURE = new Date(NOW.getTime() + 7 * DAY);
export const PAST = new Date(NOW.getTime() - DAY);

export type Fixture = ReturnType<typeof seedOrganizations>;

export function seedOrganizations() {
  // Only `Date` is faked — faking timers as well would stall anything in the
  // stack that schedules one, and nothing here needs them advanced.
  //
  // `setSystemTime` rather than the `now` option, and that is load-bearing:
  // `useFakeTimers({ now })` does **not** re-apply `now` when a fake clock is
  // already installed, so a re-seed inside a test would silently keep the
  // previous instant. The regression test at the foot of
  // `list-invitations.test.ts` was red against the `now` form.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  const d1 = createFakeD1();

  const addUser = (user: McpProps, name: string) =>
    d1.insert("user", {
      id: user.userId,
      email: user.email,
      name,
      emailVerified: 1,
      createdAt: epochSeconds(NOW),
      updatedAt: epochSeconds(NOW),
    });

  const addOrganization = (id: string, name: string, slug: string, logo: string | null = null) =>
    d1.insert("organization", { id, name, slug, logo, createdAt: epochSeconds(NOW) });

  /** `createdAt` is offset per row so the oldest-first order is a real ordering. */
  const addMember = (id: string, organizationId: string, user: McpProps, role: string, age = 0) =>
    d1.insert("member", {
      id,
      organizationId,
      userId: user.userId,
      role,
      createdAt: epochSeconds(new Date(NOW.getTime() + age * 1000)),
    });

  const addInvitation = (
    id: string,
    organizationId: string,
    email: string,
    options: { status?: string; expiresAt?: Date | null; role?: string; age?: number } = {},
  ) =>
    d1.insert("invitation", {
      id,
      organizationId,
      email,
      role: options.role ?? "member",
      status: options.status ?? "pending",
      inviterId: ANA.userId,
      expiresAt: options.expiresAt === null ? null : epochSeconds(options.expiresAt ?? FUTURE),
      createdAt: epochSeconds(new Date(NOW.getTime() + (options.age ?? 0) * 1000)),
    });

  addUser(ANA, "Ana");
  addUser(BEN, "Ben");
  addUser(CAI, "Cai");
  addUser(DIA, "Dia");

  addOrganization(ORG, "Trading", "trading", "https://cdn.test/logo.png");
  addOrganization(OTHER_ORG, "Holdings", "holdings");

  addMember("mem_ana", ORG, ANA, "owner", 0);
  addMember("mem_ben", ORG, BEN, "admin", 1);
  addMember("mem_cai", ORG, CAI, "member", 2);
  addMember("mem_dia", OTHER_ORG, DIA, "owner", 0);

  addInvitation("inv_fresh", ORG, "fin@example.com", { age: 2 });
  addInvitation("inv_older", ORG, "gus@example.com", { age: 1, role: "admin" });
  // Neither of these is "pending" as the product means it — one is spent, the
  // other cannot be accepted — so the list must show two rows, not four.
  addInvitation("inv_expired", ORG, "hal@example.com", { expiresAt: PAST });
  addInvitation("inv_accepted", ORG, "ivy@example.com", { status: "accepted" });
  addInvitation("inv_other_tenant", OTHER_ORG, "jan@example.com");

  return {
    d1,
    /** Seed `count` further organizations owned by `user`, for pagination. */
    giveOrganizations(user: McpProps, count: number, prefix: string) {
      for (let index = 0; index < count; index++) {
        const id = `${prefix}_${index}`;
        addOrganization(id, `Org ${index}`, `${prefix}-${index}`);
        addMember(`${id}_member`, id, user, "member", 10 + index);
      }
    },
    /** A `ToolContext` for one principal, over this database. */
    contextFor(user: McpProps): ToolContext {
      const env = createFakeEnv({ DB: d1 });
      return { db: createDb(env.DB as D1Database), user };
    },
    /** Every test calls this in `afterEach` — it releases the frozen clock too. */
    close: () => {
      vi.useRealTimers();
      d1.close();
    },
  };
}
