import { describe, it, expect } from "vitest";
import { createFakeEnv } from "@starter/testing/fake-env";
import { createFakeRateLimiters } from "@starter/testing/fake-rate-limit";
import { RATE_LIMIT_RULES } from "@starter/auth/rate-limit";
import { authApp } from "../auth-app";

/**
 * The MCP half of audit #3's fail-closed guarantee.
 *
 * This Worker runs its own Better Auth against the **same** D1 and the **same**
 * secret as apps/web, so a lenient env check here would undo the strict one
 * there: a session forged against this Worker is honoured by the web app too.
 *
 * These target `/api/auth/**` because that is the route which actually reaches
 * `authFor`; `/` answers from static metadata and never constructs auth.
 *
 * `pnpm check:boot` reaches that route too as of 2026-08-09, via `envProbe` on
 * the MCP boot target — so the two are complementary rather than redundant. The
 * boot check runs against the real `wrangler.jsonc`, which is what catches a
 * **renamed** binding. These tests inject the env, which is what lets them
 * **withhold** one: a missing secret, a short secret, Better Auth's default
 * secret, an absent D1. A wrangler config cannot express any of those.
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

  /**
   * At the boundary, not only in the schema. `env.test.ts` proves
   * `mcpEnvSchema` declares the rule; this proves `authFor` actually runs it,
   * which is the half that would silently lapse if the schema and the parse
   * call ever drifted apart.
   */
  it("refuses an auth request when the OAuth KV binding is absent", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv({ OAUTH_KV: undefined }));
    expect(res.status).toBe(500);
  });

  it("reaches Better Auth when the env is valid", async () => {
    const res = await authApp.request(AUTH_ROUTE, {}, mcpEnv());

    // Past validation. Better Auth answers for itself from here — what matters
    // is that the env check is no longer what stops the request.
    expect(res.status).not.toBe(500);
  });
});

/**
 * Audit #4, the part `/api/auth/**` does not reach.
 *
 * The consent screen's password form calls `auth.api.signInEmail` directly, and
 * Better Auth applies its limiter in the HTTP router's `onRequest` hook — which
 * `auth.api.*` never passes through. So rate limiting `/api/auth/**` alone
 * would leave an unlimited password-guessing oracle one path over, on a Worker
 * that shares its users and its secret with apps/web.
 */
describe("MCP /authorize sign-in rate limiting", () => {
  const AUTH_REQUEST = {
    clientId: "client-1",
    redirectUri: "https://client.test/callback",
    scope: ["mcp"],
    state: "state-1",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    issuer: "http://mcp.test",
  };

  function authorizeEnv(credentials: number) {
    return mcpEnv({
      ...createFakeRateLimiters({ credentials }),
      OAUTH_PROVIDER: {
        parseAuthRequest: async () => AUTH_REQUEST,
        lookupClient: async () => ({ clientId: "client-1", clientName: "Test Client" }),
      },
    });
  }

  function signInPost(env: Record<string, unknown>, ip = "203.0.113.9") {
    return authApp.request(
      "http://mcp.test/authorize?client_id=client-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": ip,
        },
        body: "intent=login&email=victim%40example.com&password=guess",
      },
      env,
    );
  }

  it("refuses further attempts once the credentials limit is reached", async () => {
    const env = authorizeEnv(1);

    // First attempt is answered on its merits — there is no database here, so
    // sign-in fails and the form comes back. What matters is that it was not
    // the limiter that stopped it.
    expect((await signInPost(env)).status).not.toBe(429);

    const refused = await signInPost(env);
    expect(refused.status).toBe(429);
    // Against the policy table, not a literal — a literal here would just be
    // the copy of the window that the source no longer keeps.
    expect(refused.headers.get("retry-after")).toBe(String(RATE_LIMIT_RULES.credentials.window));
  });

  it("counts a different client separately", async () => {
    const env = authorizeEnv(1);
    await signInPost(env);

    expect((await signInPost(env)).status).toBe(429);
    expect((await signInPost(env, "198.51.100.22")).status).not.toBe(429);
  });

  /**
   * Only the credential form is counted here. Consent (`approve`/`deny`) is
   * already behind a session, so charging it to the same bucket would let a
   * signed-in user's ordinary clicking lock them out of signing in.
   */
  it("does not spend the sign-in budget on a consent decision", async () => {
    const env = authorizeEnv(1);

    await authApp.request(
      "http://mcp.test/authorize?client_id=client-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: "intent=approve",
      },
      env,
    );

    expect((await signInPost(env)).status).not.toBe(429);
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
