import { describe, it, expect } from "vitest";
import {
  ApiUsageError,
  buildApiRequest,
  DEFAULT_API_URL,
  parseApiArgs,
  redactHeaders,
} from "../lib/api-client";

describe("parseApiArgs", () => {
  it("parses a method and path", () => {
    expect(parseApiArgs(["GET", "/me"])).toEqual({ method: "GET", path: "/me" });
  });

  it("uppercases the method", () => {
    expect(parseApiArgs(["get", "/me"]).method).toBe("GET");
  });

  it("accepts a JSON body", () => {
    expect(parseApiArgs(["POST", "/tokens", '{"name":"ci"}'])).toEqual({
      method: "POST",
      path: "/tokens",
      body: '{"name":"ci"}',
    });
  });

  it("omits body entirely when not supplied", () => {
    expect(parseApiArgs(["GET", "/me"])).not.toHaveProperty("body");
  });

  it.each([[[]], [["GET"]]])("rejects missing arguments (%s)", (argv) => {
    expect(() => parseApiArgs(argv as string[])).toThrow(ApiUsageError);
  });

  it("rejects an unsupported method", () => {
    expect(() => parseApiArgs(["TRACE", "/me"])).toThrow(/Unsupported method/);
  });

  it("rejects a path without a leading slash", () => {
    expect(() => parseApiArgs(["GET", "me"])).toThrow(/must start with/);
  });

  it("rejects a malformed JSON body", () => {
    expect(() => parseApiArgs(["POST", "/tokens", "{name:ci}"])).toThrow(/valid JSON/);
  });
});

describe("buildApiRequest", () => {
  const base = { method: "GET", path: "/me", token: "sk_test123" } as const;

  it("resolves the path under /api/v1 so callers omit the version", () => {
    expect(buildApiRequest(base).url).toBe(`${DEFAULT_API_URL}/api/v1/me`);
  });

  it("honours STARTER_API_URL and strips trailing slashes", () => {
    expect(buildApiRequest({ ...base, baseUrl: "https://api.example.com/" }).url).toBe(
      "https://api.example.com/api/v1/me",
    );
  });

  it("falls back to the default when the base url is empty", () => {
    expect(buildApiRequest({ ...base, baseUrl: "" }).url).toBe(`${DEFAULT_API_URL}/api/v1/me`);
  });

  it("sends the token as a Bearer credential", () => {
    expect(buildApiRequest(base).init.headers.Authorization).toBe("Bearer sk_test123");
  });

  it("adds a JSON content type only when there is a body", () => {
    expect(buildApiRequest(base).init.headers["Content-Type"]).toBeUndefined();
    expect(
      buildApiRequest({ ...base, method: "POST", path: "/tokens", body: "{}" }).init.headers[
        "Content-Type"
      ],
    ).toBe("application/json");
  });

  it("passes the body through unchanged", () => {
    const built = buildApiRequest({ ...base, method: "POST", path: "/tokens", body: '{"a":1}' });
    expect(built.init.body).toBe('{"a":1}');
  });

  // Failing loudly beats sending an unauthenticated request that 401s
  // confusingly, or worse, silently succeeding against a public route.
  it.each([undefined, ""])("refuses to build a request without a token (%s)", (token) => {
    expect(() => buildApiRequest({ ...base, token })).toThrow(/STARTER_API_TOKEN/);
  });
});

describe("redactHeaders", () => {
  it("masks the Authorization header", () => {
    expect(
      redactHeaders({ Authorization: "Bearer sk_secret", Accept: "application/json" }),
    ).toEqual({ Authorization: "Bearer [redacted]", Accept: "application/json" });
  });

  it("leaves headers without Authorization untouched", () => {
    expect(redactHeaders({ Accept: "application/json" })).toEqual({ Accept: "application/json" });
  });

  it("does not mutate its input", () => {
    const headers = { Authorization: "Bearer sk_secret" };
    redactHeaders(headers);
    expect(headers.Authorization).toBe("Bearer sk_secret");
  });
});
