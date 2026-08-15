import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ApiPrincipal, PrincipalEnv } from "@starter/auth";
import { API_BASE_PATH, apiApp } from "../api";

const store = vi.hoisted(() => ({ revokeApiToken: vi.fn().mockResolvedValue(true) }));

vi.mock("@starter/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starter/auth")>()),
  ...store,
}));

/**
 * The guarantee these tests protect is about routes nobody has written yet:
 * anything added to `api.ts` is authenticated unless its path is named in the
 * allowlist. Per-handler `requirePrincipal` calls cover today's routes — this
 * covers the next one, where the mistake is forgetting the guard entirely.
 *
 * See `docs/security-audit.md` #15.
 */

const SESSION: ApiPrincipal = { userId: "user_1", organizationId: "org_1", via: "session" };
const TOKEN: ApiPrincipal = {
  userId: "user_1",
  organizationId: "org_1",
  via: "token",
  tokenId: "tok_1",
};

/** What a browser sends on a same-origin non-GET request. */
const sameOrigin = { "sec-fetch-site": "same-origin" };

function appWith(principal: ApiPrincipal | null, mounted = false) {
  const app = new Hono<PrincipalEnv>();
  app.use(async (c, next) => {
    c.set("db", {} as never);
    c.set("principal", principal);
    await next();
  });
  app.route(mounted ? API_BASE_PATH : "/", apiApp);
  return app;
}

/** Every path the spec advertises, read from the app rather than hand-listed. */
async function advertisedPaths(): Promise<string[]> {
  const spec = (await (await apiApp.request("/doc")).json()) as {
    paths: Record<string, unknown>;
  };
  return Object.keys(spec.paths);
}

const PUBLIC = ["/health", "/doc"];

describe("default deny on /api/v1", () => {
  it("every advertised route is either public or refuses an anonymous caller", async () => {
    const paths = await advertisedPaths();
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      if (PUBLIC.includes(path)) continue;

      // Path params are irrelevant to the guard — it runs before routing.
      const res = await appWith(null).request(path.replace(/\{[^}]+\}/g, "placeholder"));
      expect(res.status, `${path} should refuse an anonymous caller`).toBe(401);
    }
  });

  it.each(PUBLIC)("%s answers without credentials", async (path) => {
    const res = await appWith(null).request(path);
    expect(res.status).toBe(200);
  });

  // The allowlist is keyed by method *and* path. Were it keyed by path alone,
  // registering `POST /health` later would silently make it public — and no
  // existing test would notice, because the route does not exist yet.
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s on a public path is still denied to an anonymous caller",
    async (method) => {
      const res = await appWith(null).request("/health", { method });
      expect(res.status).toBe(401);
    },
  );

  // The guard normalises the path, so it must hold in the real mount too — a
  // version prefix that slipped past it would leave every route wide open.
  it("still denies when mounted under the version prefix", async () => {
    const res = await appWith(null, true).request(`${API_BASE_PATH}/me`);
    expect(res.status).toBe(401);
  });

  it("still allows public routes when mounted under the version prefix", async () => {
    const res = await appWith(null, true).request(`${API_BASE_PATH}/health`);
    expect(res.status).toBe(200);
  });

  // Fail closed on paths that do not exist: the guard runs before routing
  // resolves, so it cannot know. This does not hide the surface — `GET /doc` is
  // public and lists every route — but it does remove the 404/401 difference as
  // an oracle for probing paths the spec does not advertise.
  it("refuses an unknown path rather than reporting it absent", async () => {
    const res = await appWith(null).request("/not-a-route");
    expect(res.status).toBe(401);
  });

  /**
   * The authenticated half of the same path, and the reason the terminal `all("*")`
   * exists. Without it this app answers nothing at all for an unknown path — the
   * request falls out of the mount, and in the real Worker
   * `hono-react-router-adapter` then hands it to React Router, so an API client
   * gets the branded HTML 404 page. Asserting the **body** is the point; status
   * and content type were already 404/HTML before, which is exactly what made the
   * leak survive review.
   */
  for (const principal of [SESSION, TOKEN]) {
    it(`answers an unknown path with JSON for a ${principal.via} caller`, async () => {
      const res = await appWith(principal).request("/not-a-route");

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Not Found" });
    });
  }

  it("leaves the advertised routes alone — the catch-all is last", async () => {
    // `/health` is registered above the catch-all, so it must still win. Hono
    // stops composing at the first handler that answers without calling next().
    const res = await appWith(null).request("/health");
    expect(res.status).toBe(200);

    // And the catch-all adds no path to the spec, being a plain Hono route.
    expect(await advertisedPaths()).not.toContain("/*");
  });
});

describe("CSRF on /api/v1", () => {
  it("rejects a session-authenticated write with no origin signal", async () => {
    const res = await appWith(SESSION).request("/tokens/tok_1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("accepts a session-authenticated write from the same origin", async () => {
    const res = await appWith(SESSION).request("/tokens/tok_1", {
      method: "DELETE",
      headers: sameOrigin,
    });
    expect(res.status).toBe(200);
  });

  it("rejects a session-authenticated write from a foreign origin", async () => {
    const res = await appWith(SESSION).request("/tokens/tok_1", {
      method: "DELETE",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  /**
   * The gap that `hono/csrf` left open. It only inspects requests whose
   * content type is form-shaped or absent, so a JSON body — what the settings
   * UI actually sends — skipped the check entirely and reached the handler.
   * Safe in practice only because no CORS policy exists to let the preflight
   * through, which is an assumption a future config change would quietly break.
   */
  it("rejects a JSON write with no origin signal", async () => {
    const res = await appWith(SESSION).request("/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Cross-origin request refused" });
  });

  it("rejects a JSON write from a foreign origin", async () => {
    const res = await appWith(SESSION).request("/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ name: "ci" }),
    });

    expect(res.status).toBe(403);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "checks the origin on %s regardless of content type",
    async (method) => {
      const res = await appWith(SESSION).request("/tokens", { method });
      expect(res.status).toBe(403);
    },
  );

  // Safari before 16.4 sends no Sec-Fetch-Site, so Origin has to be enough.
  it("accepts a same-origin write carrying only an Origin header", async () => {
    const res = await appWith(SESSION).request("http://localhost/tokens/tok_1", {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    });

    expect(res.status).toBe(200);
  });

  // Bearer tokens are not ambient credentials, so CSRF does not apply — and
  // enforcing it would break `pnpm api:call` on every bodyless request.
  it("does not apply to bearer-token callers", async () => {
    const res = await appWith(TOKEN).request("/tokens/tok_1", { method: "DELETE" });

    // 403 here would be the CSRF rejection; the real answer is the
    // interactive-session rule, which carries its own message.
    await expect(res.json()).resolves.toEqual({
      error: "API tokens can only be managed from an interactive session",
    });
  });

  it("leaves safe methods alone", async () => {
    const res = await appWith(SESSION).request("/me");
    expect(res.status).toBe(200);
  });
});
