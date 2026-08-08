import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { THEME_SCRIPT_CSP_HASH } from "../../app/lib/theme-script";
import {
  CSP_NONCE_KEY,
  noStoreForAuthenticated,
  securityHeaders,
  securityMiddleware,
} from "../security-headers";

/**
 * Header presence is the whole feature, so these assert on the wire format
 * rather than on configuration. See `docs/security-audit.md` #5 and #14.
 */

function appWith(...middleware: MiddlewareHandler[]) {
  const app = new Hono();
  for (const m of middleware) app.use(m);
  app.get("/thing", (c) => c.text("ok"));
  app.get("/cached", (c) => {
    c.header("cache-control", "public, max-age=60");
    return c.text("ok");
  });
  app.get("/gone", (c) => c.redirect("/thing", 302));
  // `Response.redirect` returns a response whose headers are *immutable*, unlike
  // `c.redirect`. Writing to it throws, which is the case the guard exists for.
  app.get("/immutable", () => Response.redirect("https://example.test/elsewhere", 302));
  return app;
}

const SESSION_COOKIE = { cookie: "better-auth.session_token=abc123" };

describe("securityHeaders", () => {
  it("declares a Content-Security-Policy", async () => {
    const res = await appWith(securityHeaders).request("/thing");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("refuses framing", async () => {
    const res = await appWith(securityHeaders).request("/thing");

    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("sets nosniff, referrer policy and HSTS", async () => {
    const res = await appWith(securityHeaders).request("/thing");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=63072000");
  });

  // Asserts the **quoted** form. A bare `sha256-…` is a substring of the quoted
  // one, so `toContain(THEME_SCRIPT_CSP_HASH)` passed either way — and an
  // unquoted source expression is silently discarded by the browser as invalid,
  // which is the trap AGENTS.md warns about. This is the assertion that catches it.
  it("admits the theme script by a correctly quoted hash", async () => {
    const res = await appWith(securityHeaders).request("/thing");
    expect(res.headers.get("content-security-policy")).toContain(`'${THEME_SCRIPT_CSP_HASH}'`);
  });

  it("issues a per-request nonce in script-src", async () => {
    const res = await appWith(securityHeaders).request("/thing");
    expect(res.headers.get("content-security-policy")).toMatch(/script-src[^;]*'nonce-[^']+'/);
  });

  // A reused nonce is no better than 'unsafe-inline' — an injected script could
  // simply copy the one it saw.
  it("issues a different nonce on every request", async () => {
    const app = appWith(securityHeaders);
    const nonceOf = async () =>
      /'nonce-([^']+)'/.exec(
        (await app.request("/thing")).headers.get("content-security-policy")!,
      )?.[1];

    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  it("exposes the same nonce on the context that it puts in the header", async () => {
    const app = new Hono();
    app.use(securityHeaders);
    app.get("/thing", (c) => c.text(String(c.get(CSP_NONCE_KEY as never))));

    const res = await app.request("/thing");
    const fromContext = await res.text();

    expect(fromContext).not.toBe("undefined");
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${fromContext}'`);
  });

  it("never admits unsafe-inline for scripts", async () => {
    const csp = (await appWith(securityHeaders).request("/thing")).headers.get(
      "content-security-policy",
    )!;
    const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";

    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("covers redirects too", async () => {
    const res = await appWith(securityHeaders).request("/gone");

    expect(res.status).toBe(302);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("noStoreForAuthenticated", () => {
  it("marks a response no-store when the caller has a session cookie", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/thing", {
      headers: SESSION_COOKIE,
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves anonymous responses cacheable", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/thing");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("ignores an unrelated cookie", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/thing", {
      headers: { cookie: "theme=dark" },
    });

    expect(res.headers.get("cache-control")).toBeNull();
  });

  // Better Auth prefixes the cookie in some configurations (`__Secure-`), so
  // matching the exact name would silently stop working.
  it("recognises a prefixed session cookie", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/thing", {
      headers: { cookie: "__Secure-better-auth.session_token=abc" },
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // The leak this exists to stop: a shared cache holding personalized output.
  // A route "choosing" public caching does not make it safe once a session
  // cookie is on the request.
  it("overrides a public caching directive", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/cached", {
      headers: SESSION_COOKIE,
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  function appReturning(cacheControl: string) {
    const app = new Hono();
    app.use(noStoreForAuthenticated);
    app.get("/own", (c) => {
      c.header("cache-control", cacheControl);
      return c.text("ok");
    });
    return app;
  }

  it.each(["no-store", "no-store, max-age=0", "private, no-store"])(
    "leaves %s alone — already as strong",
    async (value) => {
      const res = await appReturning(value).request("/own", { headers: SESSION_COOKIE });
      expect(res.headers.get("cache-control")).toBe(value);
    },
  );

  // `private` stops shared caches but still lets the browser store the response,
  // which leaves the shared-machine exposure #14 is about.
  it.each(["private", "private, max-age=60", "public", "max-age=600"])(
    "overrides %s — not strong enough for a personalized response",
    async (value) => {
      const res = await appReturning(value).request("/own", { headers: SESSION_COOKIE });
      expect(res.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("does not fail a redirect it cannot annotate", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/gone", {
      headers: SESSION_COOKIE,
    });

    expect(res.status).toBe(302);
  });

  // The deny path for the guard itself: a caching hint is never worth turning a
  // working response into a 500.
  it("survives a response whose headers cannot be written", async () => {
    const res = await appWith(noStoreForAuthenticated).request("/immutable", {
      headers: SESSION_COOKIE,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

/**
 * These assert the three middlewares in their real registration order, which is
 * how they run in `server/index.ts`. Testing each in isolation is what let an
 * immutable response reach `hono/secure-headers` unguarded: it threw
 * `TypeError: immutable`, and the request became a 500 carrying no security
 * headers whatsoever.
 */
describe("the middlewares mounted together", () => {
  // The exported order, exactly as `server/index.ts` mounts it.
  const chain = () => appWith(...securityMiddleware);

  it("still applies headers to an immutable response", async () => {
    const res = await chain().request("/immutable");

    expect(res.status).toBe(302);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("preserves the redirect target while rewriting the response", async () => {
    const res = await chain().request("/immutable");
    expect(res.headers.get("location")).toBe("https://example.test/elsewhere");
  });

  it("marks an immutable response no-store for a signed-in caller", async () => {
    const res = await chain().request("/immutable", { headers: SESSION_COOKIE });

    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves an ordinary response working", async () => {
    const res = await chain().request("/thing", { headers: SESSION_COOKIE });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("ok");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
