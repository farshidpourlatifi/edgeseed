import { createMiddleware } from "hono/factory";
import { NONCE, secureHeaders } from "hono/secure-headers";
import { THEME_SCRIPT_CSP_HASH } from "../app/lib/theme-script";

/**
 * Response headers every request gets, and the CSP nonce SSR renders with.
 *
 * Mounted first in the Hono chain (after observability, which must see every
 * request) so it covers SSR HTML, Better Auth responses, the versioned API and
 * the split-origin redirects alike. See `docs/security-audit.md` #5 and #14.
 */

/**
 * Where `hono/secure-headers` stores the nonce it generates. Reading it is how
 * `load-context.ts` hands the value to React Router — `NONCE` below both
 * generates it and stashes it under this key, before `next()` runs.
 */
export const CSP_NONCE_KEY = "secureHeadersNonce";

export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    /**
     * Two admission rules for two kinds of inline script, and both are needed:
     * the nonce covers React Router's `<Scripts>` and `<ScrollRestoration>`,
     * whose hydration payload differs per request and so cannot be hashed; the
     * hash covers the static theme script, which must work even on error paths
     * where root loader data — and therefore the nonce — may not reach `Layout`.
     */
    // The hash is quoted here rather than in the constant: CSP source
    // expressions require the quotes, but the constant is the bare digest the
    // hash test computes and compares. An unquoted entry is silently dropped
    // by the browser as an "invalid source", which is how this first shipped.
    scriptSrc: [NONCE, `'${THEME_SCRIPT_CSP_HASH}'`, "'self'"],
    /**
     * Tailwind injects a `<style>` element at runtime and Radix writes inline
     * `style` attributes for positioning, so neither can be hashed or nonced.
     * Style injection is not a script-execution primitive, which is why this is
     * the one directive left permissive.
     */
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'", "data:"],
    /** Same-origin XHR only. Widen deliberately when a third-party API arrives. */
    connectSrc: ["'self'"],
    /** Belt and braces with `X-Frame-Options`; this is the directive modern browsers honour. */
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
  },
  /** `SAMEORIGIN` is the library default; nothing here is meant to be framed. */
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  /**
   * Two years, with subdomains, and preload-eligible. Safe here because both
   * hostnames are Cloudflare custom domains that only ever serve https — a
   * plain-http origin would be locked out by this for the same two years.
   */
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  /** Deny by default; a product that needs a camera opts in here explicitly. */
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
});

/** True when this response will accept header writes. */
function headersAreWritable(res: Response): boolean {
  try {
    res.headers.delete("x-writability-probe");
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace an immutable response with a mutable copy, so the middleware that
 * writes headers can write to it.
 *
 * Order is handled by `securityMiddleware` below — do not mount this by hand.
 *
 * `Response.redirect()` and responses passed straight through from `fetch()`
 * carry an immutable headers guard. Writing to one throws `TypeError:
 * immutable`, and `hono/secure-headers` writes without a guard — so such a
 * response became a 500 that also carried **no security headers at all**.
 * Nothing in the web chain constructs one today; `apps/mcp/src/index.ts` already
 * hit this shape and works around it, which is exactly why the next route to do
 * it here must not be the one that discovers the problem.
 */
export const mutableResponse = createMiddleware(async (c, next) => {
  await next();

  if (headersAreWritable(c.res)) return;

  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: new Headers(c.res.headers),
  });
});

/** Requests carrying a session cookie, whatever Better Auth named it. */
function hasSessionCookie(cookie: string | undefined): boolean {
  return cookie !== undefined && /(^|;\s*)[^=]*session_token=/.test(cookie);
}

/**
 * Already as strong as what this middleware would set, so leave it alone.
 *
 * Only `no-store` qualifies. `private` is **not** enough: it keeps a response
 * out of shared caches but still lets the user's own browser store it, which
 * leaves exactly the back-button-on-a-shared-machine exposure #14 names. A
 * route that wants its authenticated output cached has to opt out somewhere
 * other than here.
 */
function alreadyNoStore(cacheControl: string): boolean {
  return /(^|,)\s*no-store\s*(,|$)/i.test(cacheControl);
}

/**
 * `Cache-Control: no-store` on anything answered for a signed-in caller.
 *
 * Keyed on the request cookie rather than a path list, so a new authenticated
 * route is covered the day it is added rather than the day someone remembers to
 * extend a list. Dashboard HTML and loader data both carry the user's name and
 * email; without this they are left to browser and proxy heuristics, and to the
 * back button on a shared machine. See `docs/security-audit.md` #14.
 *
 * **Overrides a weaker directive rather than deferring to it.** An earlier
 * version kept any existing `Cache-Control` on the grounds that a route had
 * "chosen" it, which let `public, max-age=60` survive onto a personalized
 * response. `private` is overridden too: it stops shared caches but not the
 * user's own browser, and #14 is about the back button on a shared machine as
 * much as about proxies. Only an existing `no-store` is left alone.
 */
export const noStoreForAuthenticated = createMiddleware(async (c, next) => {
  await next();

  if (!hasSessionCookie(c.req.header("cookie"))) return;

  const existing = c.res.headers.get("cache-control");
  if (existing && alreadyNoStore(existing)) return;

  // Belt and braces: `mutableResponse` should have handled this already, but a
  // caching hint is never worth failing a request over if the order ever slips.
  try {
    c.res.headers.set("cache-control", "no-store");
  } catch {
    // Immutable response — nothing to do.
  }
});

/**
 * The three middlewares in the one order that works. Mount with
 * `app.use(...securityMiddleware)` and do not reorder at the call site.
 *
 * Hono unwinds post-`next()` code in **reverse** registration order, so this
 * list reads backwards from the order things actually happen on the way out:
 *
 * 1. `mutableResponse` — registered last, therefore runs first, so the response
 *    is writable before anything tries to write to it.
 * 2. `noStoreForAuthenticated` — needs a writable response.
 * 3. `securityHeaders` — needs a writable response, and throws without one.
 *
 * Exported as an ordered list rather than documented as a convention because
 * getting it wrong is silent: the headers simply stop being applied, and every
 * unit test that exercises a middleware on its own still passes.
 */
export const securityMiddleware = [
  securityHeaders,
  noStoreForAuthenticated,
  mutableResponse,
] as const;
