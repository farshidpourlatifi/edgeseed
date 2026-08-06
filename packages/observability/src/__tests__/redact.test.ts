import { describe, it, expect } from "vitest";
import { CIRCULAR, isSensitiveKey, redact, REDACTED, TRUNCATED } from "../redact";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "passwd",
    "BETTER_AUTH_SECRET",
    "sessionToken",
    "Authorization",
    "Cookie",
    "x-api-key",
    "apiKey",
    "client_secret",
    "privateKey",
    "SENTRY_DSN",
  ])("flags %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["userId", "email", "status", "durationMs", "requestId", "name"])(
    "leaves %s alone",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("redact", () => {
  it("passes primitives through unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("stringifies values JSON cannot represent", () => {
    expect(redact(Number.NaN)).toBe("NaN");
    expect(redact(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(redact(10n)).toBe("10n");
    expect(redact(() => 1)).toBe("[function]");
    expect(redact(Symbol("s"))).toBe("Symbol(s)");
  });

  it("blanks sensitive keys but keeps the rest of the object", () => {
    expect(redact({ userId: "u1", password: "hunter2", token: "abc" })).toEqual({
      userId: "u1",
      password: REDACTED,
      token: REDACTED,
    });
  });

  it("blanks sensitive keys at any depth", () => {
    expect(redact({ a: { b: { headers: { authorization: "Bearer x" } } } })).toEqual({
      a: { b: { headers: { authorization: REDACTED } } },
    });
  });

  it("never mutates the input", () => {
    const input = { password: "hunter2", nested: { token: "t" } };
    redact(input);
    expect(input.password).toBe("hunter2");
    expect(input.nested.token).toBe("t");
  });

  it("expands Errors into plain objects", () => {
    const error = new TypeError("boom");
    const result = redact({ error }) as { error: Record<string, unknown> };
    expect(result.error.name).toBe("TypeError");
    expect(result.error.message).toBe("boom");
    expect(result.error.stack).toContain("boom");
  });

  it("keeps custom Error fields and redacts the sensitive ones", () => {
    const error = Object.assign(new Error("nope"), { status: 401, apiKey: "sk-live-123" });
    const result = redact(error) as Record<string, unknown>;
    expect(result.status).toBe(401);
    expect(result.apiKey).toBe(REDACTED);
  });

  it("does not duplicate Error keys that are also own enumerable properties", () => {
    const error = new Error("real message");
    Object.defineProperty(error, "message", { value: "real message", enumerable: true });

    const result = redact(error) as Record<string, unknown>;
    expect(result.message).toBe("real message");
  });

  it("follows Error causes", () => {
    const error = new Error("outer", { cause: new Error("inner") });
    const result = redact(error) as { cause: Record<string, unknown> };
    expect(result.cause.message).toBe("inner");
  });

  it("breaks cycles", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;
    expect(redact(node)).toEqual({ name: "root", self: CIRCULAR });
  });

  it("serializes the same object twice when it is shared, not cyclic", () => {
    const shared = { id: 1 };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("truncates past the depth limit", () => {
    expect(redact({ a: { b: { c: "deep" } } }, { maxDepth: 2 })).toEqual({
      a: { b: TRUNCATED },
    });
  });

  it("caps long arrays with a count of what was dropped", () => {
    const result = redact(Array.from({ length: 105 }, (_, i) => i)) as unknown[];
    expect(result).toHaveLength(101);
    expect(result[100]).toBe("[+5 more]");
  });

  it("normalises Date, RegExp, Set and Map", () => {
    const date = new Date("2026-08-04T00:00:00.000Z");
    expect(redact(date)).toBe("2026-08-04T00:00:00.000Z");
    expect(redact(/ab+c/i)).toBe("/ab+c/i");
    expect(redact(new Set([1, 2]))).toEqual([1, 2]);
    expect(redact(new Map([["secret", "s"]]))).toEqual({ secret: REDACTED });
  });
});
