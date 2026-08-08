import { describe, it, expect } from "vitest";
import { createFakeEnv } from "@starter/testing/fake-env";
import { authApp } from "../auth-app";

/**
 * The MCP half of audit #3's fail-closed guarantee.
 *
 * This Worker runs its own Better Auth against the **same** D1 and the **same**
 * secret as apps/web, so a lenient env check here would undo the strict one
 * there: a session forged against this Worker is honoured by the web app too.
 *
 * `pnpm check:boot` does not cover it. The boot check requests `/`, which
 * answers from static metadata and never constructs auth — so deleting
 * `parseEnv` from `authFor` would leave the whole gate green. That gap is why
 * these tests target `/api/auth/**`, the route that actually reaches it.
 */

/** The MCP schema has no BETTER_AUTH_URL — this Worker derives its origin. */
function mcpEnv(overrides: Record<string, unknown> = {}) {
  return createFakeEnv({ BETTER_AUTH_URL: undefined, ...overrides });
}

const AUTH_ROUTE = "http://mcp.test/api/auth/get-session";

describe("MCP authFor env validation", () => {
  it("refuses an auth request when BETTER_AUTH_SECRET is missing", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv({ BETTER_AUTH_SECRET: undefined }));
    expect(res.status).toBe(500);
  });

  // The value that ships when nobody ran `wrangler secret put`. Accepting it
  // here would let anyone mint a session this Worker and the web app both trust.
  it("refuses an auth request when the secret is Better Auth's default", async () => {
    const res = await authApp.request(
      AUTH_ROUTE,
      {},
      mcpEnv({ BETTER_AUTH_SECRET: "better-auth-secret-12345678901234567890" }),
    );

    expect(res.status).toBe(500);
  });

  it("refuses an auth request when the secret is too short", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv({ BETTER_AUTH_SECRET: "short" }));
    expect(res.status).toBe(500);
  });

  it("refuses an auth request when the D1 binding is absent", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv({ DB: null }));
    expect(res.status).toBe(500);
  });

  it("reaches Better Auth when the env is valid", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv());

    // Past validation. Better Auth answers for itself from here — what matters
    // is that the env check is no longer what stops the request.
    expect(res.status).not.toBe(500);
  });
});

describe("MCP discovery endpoint", () => {
  /**
   * Deliberately unaffected by the env: `/` serves only this server's name,
   * version and authorization path, so there is nothing to protect and a
   * misconfigured Worker can still be discovered and diagnosed.
   *
   * Pinned as a test because `check:boot` depends on it — if this route ever
   * starts constructing auth, the boot check breaks in CI and the cause is not
   * obvious from the failure.
   */
  it("answers without a valid auth env", async () => {
    const res = await authApp.request(
      "http://mcp.test/",
      {},
      mcpEnv({ BETTER_AUTH_SECRET: undefined }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ authorization: "/authorize" });
  });
});
