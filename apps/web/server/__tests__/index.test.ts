import { describe, it, expect } from "vitest";
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
