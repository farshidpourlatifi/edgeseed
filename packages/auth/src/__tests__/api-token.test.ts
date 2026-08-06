import { describe, it, expect } from "vitest";
import {
  API_TOKEN_PREFIX,
  extractBearerToken,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  isApiTokenUsable,
} from "../helpers/api-token";

describe("generateApiToken", () => {
  it("returns a prefixed token with its hash and display prefix", async () => {
    const generated = await generateApiToken();

    expect(generated.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(generated.tokenHash).toBe(await hashApiToken(generated.token));
    expect(generated.token.startsWith(generated.prefix)).toBe(true);
  });

  it("never returns the plaintext inside the stored fields", async () => {
    const { token, tokenHash, prefix } = await generateApiToken();

    expect(tokenHash).not.toContain(token);
    // The display prefix is a short head, not the whole secret.
    expect(prefix.length).toBeLessThan(token.length);
  });

  it("is unguessable — no collisions across many mints", async () => {
    const tokens = await Promise.all(Array.from({ length: 50 }, () => generateApiToken()));
    const unique = new Set(tokens.map((t) => t.token));

    expect(unique.size).toBe(50);
  });

  it("carries enough entropy to be worth storing hashed", async () => {
    const { token } = await generateApiToken();
    // 32 random bytes in base64url ≈ 43 chars, plus the prefix.
    expect(token.length).toBeGreaterThanOrEqual(API_TOKEN_PREFIX.length + 40);
  });

  it("emits url-safe characters only", async () => {
    const { token } = await generateApiToken();
    expect(token.slice(API_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashApiToken", () => {
  it("produces a 64-char hex sha-256 digest", async () => {
    expect(await hashApiToken("sk_example")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    expect(await hashApiToken("sk_example")).toBe(await hashApiToken("sk_example"));
  });

  it("differs for different inputs", async () => {
    expect(await hashApiToken("sk_a")).not.toBe(await hashApiToken("sk_b"));
  });
});

describe("isApiTokenFormat", () => {
  it("accepts a freshly minted token", async () => {
    const { token } = await generateApiToken();
    expect(isApiTokenFormat(token)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["sk_short", "too short"],
    ["nope_aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "wrong prefix"],
  ])("rejects %s (%s)", (value) => {
    expect(isApiTokenFormat(value)).toBe(false);
  });

  it.each([null, undefined, 42, {}])("rejects the non-string %s", (value) => {
    expect(isApiTokenFormat(value)).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("pulls the credential out of a Bearer header", () => {
    expect(extractBearerToken("Bearer sk_abc123")).toBe("sk_abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer sk_abc123")).toBe("sk_abc123");
  });

  it("tolerates surrounding and repeated whitespace", () => {
    expect(extractBearerToken("  Bearer   sk_abc123  ")).toBe("sk_abc123");
  });

  it.each([
    [null, "null"],
    [undefined, "undefined"],
    ["", "empty"],
    ["sk_abc123", "no scheme"],
    ["Basic dXNlcjpwYXNz", "wrong scheme"],
    ["Bearer", "scheme only"],
    ["Bearer a b", "two values"],
  ])("returns null for %s (%s)", (header) => {
    expect(extractBearerToken(header as string | null | undefined)).toBeNull();
  });
});

describe("isApiTokenUsable", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("accepts a token with no expiry and no revocation", () => {
    expect(isApiTokenUsable({}, now)).toBe(true);
    expect(isApiTokenUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
  });

  it("accepts a token expiring in the future", () => {
    expect(isApiTokenUsable({ expiresAt: new Date("2026-08-05T00:00:00.000Z") }, now)).toBe(true);
  });

  it("rejects a revoked token even if it has not expired", () => {
    expect(
      isApiTokenUsable(
        { revokedAt: new Date("2026-08-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01") },
        now,
      ),
    ).toBe(false);
  });

  it("rejects an expired token", () => {
    expect(isApiTokenUsable({ expiresAt: new Date("2026-08-04T11:59:59.000Z") }, now)).toBe(false);
  });

  // Expiry is exclusive: a token is dead the instant it reaches expiresAt.
  it("rejects a token exactly at its expiry", () => {
    expect(isApiTokenUsable({ expiresAt: now }, now)).toBe(false);
  });
});
