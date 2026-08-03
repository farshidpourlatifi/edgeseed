import { describe, it, expect } from "vitest";
import { ROLES, hasRole } from "../helpers/roles";

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
