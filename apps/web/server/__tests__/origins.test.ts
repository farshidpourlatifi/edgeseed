import { describe, it, expect } from "vitest";
import { APP_PATH_PREFIXES, isAppPath, resolveOriginRequest } from "../origins";

const MARKETING = "https://edgeseed.dev";
const APP = "https://app.edgeseed.dev";

const SERVE = { action: "serve" };
const REFUSE = { action: "refuse" };
const redirectTo = (url: string) => ({ action: "redirect", url });

/** Split mode. Single-origin cases call the resolver directly — passing an
 *  explicit `undefined` to a defaulted parameter would silently take the
 *  default and test the wrong mode. */
const resolve = (requestUrl: string) =>
  resolveOriginRequest({ marketingUrl: MARKETING, appUrl: APP, requestUrl });

describe("resolveOriginRequest — single-origin mode (the default)", () => {
  it("should serve everything in place when no marketing origin is set", () => {
    for (const path of ["/", "/login", "/dashboard", "/api/v1/health"]) {
      expect(
        resolveOriginRequest({
          marketingUrl: undefined,
          appUrl: APP,
          requestUrl: `${APP}${path}`,
        }),
      ).toEqual(SERVE);
    }
  });

  it("should treat an empty marketing origin as unset", () => {
    expect(
      resolveOriginRequest({ marketingUrl: "", appUrl: APP, requestUrl: `${APP}/login` }),
    ).toEqual(SERVE);
  });

  it("should serve everything in place on localhost, where both are one host", () => {
    expect(
      resolveOriginRequest({
        marketingUrl: undefined,
        appUrl: "http://localhost:5173",
        requestUrl: "http://localhost:5173/dashboard",
      }),
    ).toEqual(SERVE);
  });

  it("should not refuse an unrecognised host when no topology is declared", () => {
    // The guard enforces a topology; without one there is nothing to enforce,
    // and refusing here would break every single-origin deploy — a `workers.dev`
    // hostname, a preview alias, a hostname that simply is not BETTER_AUTH_URL.
    expect(
      resolveOriginRequest({
        marketingUrl: undefined,
        appUrl: APP,
        requestUrl: "https://edgeseed-web.someone.workers.dev/login",
      }),
    ).toEqual(SERVE);
  });
});

describe("resolveOriginRequest — split mode", () => {
  it.each(APP_PATH_PREFIXES)("should move %s off the marketing origin", (prefix) => {
    expect(resolve(`${MARKETING}${prefix}`)).toEqual(redirectTo(`${APP}${prefix}`));
  });

  it("should keep the landing page on the marketing origin", () => {
    expect(resolve(`${MARKETING}/`)).toEqual(SERVE);
  });

  it("should send the app origin's root back to the marketing origin", () => {
    // Otherwise the landing page answers on two hostnames — duplicate content
    // and no canonical URL.
    expect(resolve(`${APP}/`)).toEqual(redirectTo(`${MARKETING}/`));
  });

  it("should serve app paths in place on the app origin", () => {
    expect(resolve(`${APP}/dashboard`)).toEqual(SERVE);
    expect(resolve(`${APP}/api/v1/health`)).toEqual(SERVE);
  });

  it("should preserve the path and query string when redirecting", () => {
    expect(resolve(`${MARKETING}/dashboard/settings?tab=tokens`)).toEqual(
      redirectTo(`${APP}/dashboard/settings?tab=tokens`),
    );
  });

  it("should never redirect the marketing page's own assets", () => {
    // The allowlist is what buys this: nothing has to remember to exclude them.
    for (const path of ["/assets/app-abc123.js", "/favicon.ico", "/edgeseed-logo.svg"]) {
      expect(resolve(`${MARKETING}${path}`)).toEqual(SERVE);
    }
  });
});

describe("resolveOriginRequest — an origin nobody configured is refused", () => {
  it("should refuse a hostname that is neither origin", () => {
    expect(resolve("https://staging.edgeseed.dev/login")).toEqual(REFUSE);
  });

  it("should refuse a hostname that routes here but neither variable names", () => {
    // The reason this guard exists at all: `routes` and the two origin
    // variables are independent lists. A third custom domain, a dashboard zone
    // route, or an explicitly enabled workers.dev/preview URL puts a hostname
    // on this Worker that appears in no OAuth registration, in no
    // BETTER_AUTH_URL, and therefore in no `trustedOrigins`.
    expect(resolve("https://legacy.edgeseed.dev/api/auth/sign-in/email")).toEqual(REFUSE);
    expect(resolve("https://edgeseed-web.someone.workers.dev/api/auth/sign-in/email")).toEqual(
      REFUSE,
    );
  });

  it("should refuse every path the Worker sees, not only the app paths", () => {
    // A marketing page on an undeclared origin is still an ambiguous canonical
    // URL, so the refusal is not narrowed to APP_PATH_PREFIXES.
    //
    // "Every path the Worker sees" is the honest scope: Cloudflare matches
    // static assets ahead of the Worker (`run_worker_first` defaults to false),
    // so `/assets/*` and the favicons still answer 200 on a refused hostname.
    // They are public bytes with no auth surface — see docs/domains.md, which
    // says so rather than implying the hostname goes dark.
    for (const path of ["/", "/pricing", "/dashboard/settings", "/api/v1/health"]) {
      expect(resolve(`https://staging.edgeseed.dev${path}`)).toEqual(REFUSE);
    }
  });

  it("should refuse a configured hostname reached on a non-standard port", () => {
    // Cloudflare proxies HTTPS on 2053/2083/2087/2096/8443 as well as 443, and
    // `URL.host` carries the port — so this really is a distinct origin, and one
    // that neither BETTER_AUTH_URL nor any OAuth callback names.
    expect(resolve("https://app.edgeseed.dev:8443/login")).toEqual(REFUSE);
  });
});

describe("resolveOriginRequest — misconfiguration must not loop or take the site down", () => {
  it("should do nothing when both origins name the same host", () => {
    // A redirect to the same host is an infinite loop that serves nothing —
    // strictly worse than falling back to single-origin behaviour.
    expect(
      resolveOriginRequest({
        marketingUrl: APP,
        appUrl: APP,
        requestUrl: `${APP}/login`,
      }),
    ).toEqual(SERVE);
  });

  it("should refuse nothing when both origins name the same host", () => {
    // The fallback is the *whole* of single-origin behaviour, not half of it. A
    // marketing apex still listed in `routes` matches neither origin in this
    // state, and 404ing the public landing page over one copy-pasted secret is
    // a worse outcome than the hole it would close. Same reasoning as the
    // malformed-URL cases below: a self-contradictory topology has not been
    // declared, so there is none to enforce.
    expect(
      resolveOriginRequest({
        marketingUrl: APP,
        appUrl: APP,
        requestUrl: `${MARKETING}/login`,
      }),
    ).toEqual(SERVE);
  });

  it("should do nothing when the origins differ only by scheme", () => {
    expect(
      resolveOriginRequest({
        marketingUrl: "http://app.edgeseed.dev",
        appUrl: "https://app.edgeseed.dev",
        requestUrl: "http://app.edgeseed.dev/login",
      }),
    ).toEqual(SERVE);
  });

  it.each([
    ["marketing", "not-a-url", APP],
    ["app", MARKETING, "not-a-url"],
  ])("should do nothing when the %s origin is malformed", (_which, marketingUrl, appUrl) => {
    expect(
      resolveOriginRequest({ marketingUrl, appUrl, requestUrl: `${MARKETING}/login` }),
    ).toEqual(SERVE);
  });

  it("should serve rather than refuse when an origin is malformed", () => {
    // Refusing needs both origins to compare against. A bad binding must not
    // turn into a site that answers nothing at all, one request at a time.
    expect(
      resolveOriginRequest({
        marketingUrl: "not-a-url",
        appUrl: APP,
        requestUrl: "https://staging.edgeseed.dev/login",
      }),
    ).toEqual(SERVE);
  });

  it("should not throw on a malformed request url", () => {
    expect(() => resolve("://nonsense")).not.toThrow();
    expect(resolve("://nonsense")).toEqual(SERVE);
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
