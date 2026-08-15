import { describe, it, expect } from "vitest";
import { ROLES, ORG_CAPABILITIES, can, hasRole } from "../helpers/roles";

describe("hasRole", () => {
  it("owner satisfies every level", () => {
    expect(hasRole(ROLES.owner, ROLES.owner)).toBe(true);
    expect(hasRole(ROLES.owner, ROLES.admin)).toBe(true);
    expect(hasRole(ROLES.owner, ROLES.member)).toBe(true);
  });

  it("admin satisfies admin and member but not owner", () => {
    expect(hasRole(ROLES.admin, ROLES.owner)).toBe(false);
    expect(hasRole(ROLES.admin, ROLES.admin)).toBe(true);
    expect(hasRole(ROLES.admin, ROLES.member)).toBe(true);
  });

  it("member satisfies only member", () => {
    expect(hasRole(ROLES.member, ROLES.owner)).toBe(false);
    expect(hasRole(ROLES.member, ROLES.admin)).toBe(false);
    expect(hasRole(ROLES.member, ROLES.member)).toBe(true);
  });

  it("unknown user roles never satisfy a requirement", () => {
    expect(hasRole("superuser", ROLES.member)).toBe(false);
    expect(hasRole("", ROLES.member)).toBe(false);
  });
});

/**
 * The matrix itself, asserted as a table rather than as prose.
 *
 * Written out per role and per capability on purpose: `can` is three lines and
 * would pass a test that merely re-derived it from `ORG_CAPABILITIES`. What is
 * worth catching is somebody widening an entry in that object, and only a
 * literal expectation catches that.
 */
describe("can", () => {
  const EXPECTED: Record<string, Record<string, boolean>> = {
    owner: {
      invite: true,
      revokeInvitation: true,
      readInvitations: true,
      changeRole: true,
      removeMember: true,
      leave: true,
    },
    admin: {
      invite: true,
      revokeInvitation: true,
      readInvitations: true,
      // The two that Better Auth's own `adminAc` would allow, and this repo
      // does not. `organization.test.ts` proves the endpoint agrees.
      changeRole: false,
      removeMember: false,
      leave: true,
    },
    member: {
      invite: false,
      revokeInvitation: false,
      readInvitations: false,
      changeRole: false,
      removeMember: false,
      leave: true,
    },
  };

  for (const [role, capabilities] of Object.entries(EXPECTED)) {
    for (const [capability, allowed] of Object.entries(capabilities)) {
      it(`${role} ${allowed ? "may" : "may not"} ${capability}`, () => {
        expect(can(role, capability as keyof typeof ORG_CAPABILITIES)).toBe(allowed);
      });
    }
  }

  it("covers every capability, so a new one cannot arrive untested", () => {
    expect(Object.keys(EXPECTED.owner!).sort()).toEqual(Object.keys(ORG_CAPABILITIES).sort());
  });

  /** Fails closed, the same way `hasRole` does — an unknown role does nothing. */
  it("refuses a role it does not recognise", () => {
    for (const capability of Object.keys(ORG_CAPABILITIES)) {
      expect(can("superuser", capability as keyof typeof ORG_CAPABILITIES)).toBe(false);
      expect(can("", capability as keyof typeof ORG_CAPABILITIES)).toBe(false);
    }
  });
});
