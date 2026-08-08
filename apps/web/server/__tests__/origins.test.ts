import { describe, it, expect } from "vitest";
import { APP_PATH_PREFIXES, isAppPath, resolveOriginRedirect } from "../origins";

const MARKETING = "https://edgeseed.dev";
const APP = "https://app.edgeseed.dev";

/** Split mode. Single-origin cases call the resolver directly — passing an
 *  explicit `undefined` to a defaulted parameter would silently take the
 *  default and test the wrong mode. */
const resolve = (requestUrl: string) =>
  resolveOriginRedirect({ marketingUrl: MARKETING, appUrl: APP, requestUrl });

describe("resolveOriginRedirect — single-origin mode (the default)", () => {
  it("should serve everything in place when no marketing origin is set", () => {
    for (const path of ["/", "/login", "/dashboard", "/api/v1/health"]) {
      expect(
        resolveOriginRedirect({
          marketingUrl: undefined,
          appUrl: APP,
          requestUrl: `${APP}${path}`,
        }),
      ).toBeNull();
    }
  });

  it("should treat an empty marketing origin as unset", () => {
    expect(
      resolveOriginRedirect({ marketingUrl: "", appUrl: APP, requestUrl: `${APP}/login` }),
    ).toBeNull();
  });

  it("should serve everything in place on localhost, where both are one host", () => {
    expect(
      resolveOriginRedirect({
        marketingUrl: undefined,
        appUrl: "http://localhost:5173",
        requestUrl: "http://localhost:5173/dashboard",
      }),
    ).toBeNull();
  });
});

describe("resolveOriginRedirect — split mode", () => {
  it.each(APP_PATH_PREFIXES)("should move %s off the marketing origin", (prefix) => {
    expect(resolve(`${MARKETING}${prefix}`)).toBe(`${APP}${prefix}`);
  });

  it("should keep the landing page on the marketing origin", () => {
    expect(resolve(`${MARKETING}/`)).toBeNull();
  });

  it("should send the app origin's root back to the marketing origin", () => {
    // Otherwise the landing page answers on two hostnames — duplicate content
    // and no canonical URL.
    expect(resolve(`${APP}/`)).toBe(`${MARKETING}/`);
  });

  it("should serve app paths in place on the app origin", () => {
    expect(resolve(`${APP}/dashboard`)).toBeNull();
    expect(resolve(`${APP}/api/v1/health`)).toBeNull();
  });

  it("should preserve the path and query string when redirecting", () => {
    expect(resolve(`${MARKETING}/dashboard/settings?tab=tokens`)).toBe(
      `${APP}/dashboard/settings?tab=tokens`,
    );
  });

  it("should never redirect the marketing page's own assets", () => {
    // The allowlist is what buys this: nothing has to remember to exclude them.
    for (const path of ["/assets/app-abc123.js", "/favicon.ico", "/edgeseed-logo.svg"]) {
      expect(resolve(`${MARKETING}${path}`)).toBeNull();
    }
  });

  it("should ignore a request for some third hostname", () => {
    expect(resolve("https://staging.edgeseed.dev/login")).toBeNull();
  });
});

describe("resolveOriginRedirect — misconfiguration must not loop", () => {
  it("should do nothing when both origins name the same host", () => {
    // A redirect to the same host is an infinite loop that serves nothing —
    // strictly worse than falling back to single-origin behaviour.
    expect(
      resolveOriginRedirect({
        marketingUrl: APP,
        appUrl: APP,
        requestUrl: `${APP}/login`,
      }),
    ).toBeNull();
  });

  it("should do nothing when the origins differ only by scheme", () => {
    expect(
      resolveOriginRedirect({
        marketingUrl: "http://app.edgeseed.dev",
        appUrl: "https://app.edgeseed.dev",
        requestUrl: "http://app.edgeseed.dev/login",
      }),
    ).toBeNull();
  });

  it.each([
    ["marketing", "not-a-url", APP],
    ["app", MARKETING, "not-a-url"],
  ])("should do nothing when the %s origin is malformed", (_which, marketingUrl, appUrl) => {
    expect(
      resolveOriginRedirect({ marketingUrl, appUrl, requestUrl: `${MARKETING}/login` }),
    ).toBeNull();
  });

  it("should not throw on a malformed request url", () => {
    expect(() => resolve("://nonsense")).not.toThrow();
    expect(resolve("://nonsense")).toBeNull();
  });
});

describe("isAppPath", () => {
  it.each(APP_PATH_PREFIXES)("should match %s exactly", (prefix) => {
    expect(isAppPath(prefix)).toBe(true);
  });

  it.each(APP_PATH_PREFIXES)("should match below %s", (prefix) => {
    expect(isAppPath(`${prefix}/nested/deeper`)).toBe(true);
  });

  it("should not match a path that merely starts with the same letters", () => {
    // `/loginable` is a marketing page, not the login screen.
    expect(isAppPath("/loginable")).toBe(false);
    expect(isAppPath("/registers-of-things")).toBe(false);
    expect(isAppPath("/apiary")).toBe(false);
  });

  it("should not match the landing page", () => {
    expect(isAppPath("/")).toBe(false);
  });

  it("should not match an unrelated marketing path", () => {
    expect(isAppPath("/pricing")).toBe(false);
  });
});
