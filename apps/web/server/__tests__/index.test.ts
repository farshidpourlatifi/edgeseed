import { describe, it, expect, vi } from "vitest";
import { createFakeEnv } from "@starter/testing/fake-env";
import app from "../index";

/**
 * The middleware chain's *order* is a security property, not a style choice, so
 * it gets assertions rather than being left to review:
 *
 * - security headers above the origin redirect, so a redirect carries them;
 * - the origin redirect above `authMiddleware`, so auth cannot construct on the
 *   marketing origin (`docs/domains.md`);
 * - `authMiddleware` above everything else, so a bad env refuses the request
 *   (`docs/security-audit.md` #3).
 */

const MARKETING = "https://marketing.test";
const APP = "https://app.test";

const splitEnv = () =>
  createFakeEnv({ BETTER_AUTH_URL: APP, MARKETING_URL: MARKETING }) as Record<string, unknown>;

describe("the web server chain", () => {
  it("answers an unauthenticated request with the security headers", async () => {
    const res = await app.request(`${APP}/api/v1/health`, {}, splitEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  // Ordering assertion: the redirect returns before authMiddleware runs, so the
  // headers can only be present if securityHeaders sits above both.
  it("puts the security headers on an origin redirect too", async () => {
    const res = await app.request(`${MARKETING}/dashboard`, {}, splitEnv());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/dashboard`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("bounces the landing page off the app origin", async () => {
    const res = await app.request(`${APP}/`, {}, splitEnv());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${MARKETING}/`);
  });

  // The redirect must win before auth constructs — otherwise a request on the
  // marketing origin would build an auth instance there, which the split exists
  // to prevent. A deliberately broken secret proves which one ran first.
  it("redirects on the marketing origin without constructing auth", async () => {
    const env = { ...splitEnv(), BETTER_AUTH_SECRET: undefined };
    const res = await app.request(`${MARKETING}/login`, {}, env);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/login`);
  });

  it("refuses a request on the app origin when the env is invalid", async () => {
    const env = { ...splitEnv(), BETTER_AUTH_SECRET: "too-short" };
    const res = await app.request(`${APP}/api/v1/me`, {}, env);

    expect(res.status).toBe(500);
  });

  it("still answers 401 for an anonymous API caller when the env is valid", async () => {
    const res = await app.request(`${APP}/api/v1/me`, {}, splitEnv());
    expect(res.status).toBe(401);
  });
});

describe("the web server chain — an unconfigured origin (issue #6)", () => {
  const STRAY = "https://edgeseed-web.someone.workers.dev";

  it("refuses a hostname that is neither origin", async () => {
    const res = await app.request(`${STRAY}/login`, {}, splitEnv());

    expect(res.status).toBe(404);
    // Not the login page with a 404 status on it.
    expect(await res.text()).toBe("Not Found");
  });

  // The origin is taken from the request URL — which on Workers is the Host
  // Cloudflare routed on — never from a header a client can write. Same
  // reasoning as `ipAddressHeaders` being one entry long: a forwarding header
  // is attacker-controlled, and this one would hand back the whole auth surface.
  it.each(["x-forwarded-host", "host", "x-forwarded-server"])(
    "still refuses when %s claims the app origin",
    async (header) => {
      const res = await app.request(
        `${STRAY}/api/auth/sign-in/email`,
        { method: "POST", headers: { [header]: "app.test" } },
        splitEnv(),
      );

      expect(res.status).toBe(404);
    },
  );

  it("logs the refusal, which is the signal an operator acts on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await app.request(`${STRAY}/login`, {}, splitEnv());

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "origin.refused",
        host: "edgeseed-web.someone.workers.dev",
        path: "/login",
      }),
    );
    warn.mockRestore();
  });

  // The same ordering assertion as the redirect above, at the guard that
  // matters most: the auth surface must not construct on a hostname nobody
  // declared. A deliberately broken secret proves which middleware ran first —
  // authMiddleware would answer 500.
  it("refuses without constructing auth", async () => {
    const env = { ...splitEnv(), BETTER_AUTH_SECRET: undefined };
    const res = await app.request(`${STRAY}/api/auth/sign-in/email`, { method: "POST" }, env);

    expect(res.status).toBe(404);
  });

  it("carries the security headers on the refusal", async () => {
    const res = await app.request(`${STRAY}/dashboard`, {}, splitEnv());

    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves that same hostname in single-origin mode", async () => {
    // The guard enforces a declared topology. Without MARKETING_URL there is
    // none, and refusing would break `pnpm dev` and every one-hostname deploy.
    const res = await app.request(
      `${STRAY}/api/v1/health`,
      {},
      createFakeEnv({ BETTER_AUTH_URL: APP }) as Record<string, unknown>,
    );

    expect(res.status).toBe(200);
  });
});
