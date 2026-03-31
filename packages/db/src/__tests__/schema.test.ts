import { describe, it, expect } from "vitest";
import { user, organization, member } from "../schema/index";
import { getTableName } from "drizzle-orm";

describe("schema", () => {
  it("should define user table with correct name", () => {
    expect(getTableName(user)).toBe("user");
  });

  it("should define organization table with correct name", () => {
    expect(getTableName(organization)).toBe("organization");
  });

  it("should define member table with correct name", () => {
    expect(getTableName(member)).toBe("member");
  });
});
