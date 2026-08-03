import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy conditionals", () => {
    const enabled = false as boolean;
    expect(cn("a", enabled && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets the last conflicting Tailwind class win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles object and array syntax", () => {
    expect(cn({ a: true, b: false }, ["c"])).toBe("a c");
  });
});
