/**
 * Optional split-origin topology: marketing site on one hostname, the
 * application on another.
 *
 * Off by default. With `MARKETING_URL` unset every request is served where it
 * arrived and the app behaves exactly as it always has — one origin serving the
 * landing page and the product together, which is what works on
 * `localhost:5173` with no configuration at all. Same idiom as `SENTRY_DSN` and
 * `RESEND_API_KEY`: absent means the simpler thing.
 *
 * Set it and two things happen: the origins separate, and the set of hostnames
 * this Worker will answer on becomes **closed**. See docs/domains.md.
 */

/**
 * Paths that belong to the application rather than the marketing site.
 *
 * An **allowlist of things to move**, not a denylist of things to keep — which
 * is what makes it safe. The marketing page's own assets (`/assets/*`,
 * favicons, images) are not enumerated here, so they can never be redirected
 * out from under the landing page by something nobody thought to exclude.
 */
export const APP_PATH_PREFIXES = ["/login", "/register", "/dashboard", "/api"] as const;

export interface ResolveOriginRequestInput {
  /** `MARKETING_URL`. Undefined/empty ⇒ single-origin mode. */
  marketingUrl: string | undefined;
  /** `BETTER_AUTH_URL` — the app origin by definition, since auth pins it. */
  appUrl: string;
  /** The full request URL. */
  requestUrl: string;
}

/**
 * What to do with a request, given the configured topology.
 *
 * `refuse` is the one that is not about routing. **`routes` and these two
 * variables are independent lists**, and nothing reconciles them: a third
 * `custom_domain` entry, a zone route added in the dashboard, an explicit
 * `workers_dev`/`preview_urls`, or a legacy record still pointed at the account
 * all put a hostname on this Worker that neither variable names. Served, each
 * of them carries `/login`, `/register` and `/api/auth` — the full auth surface
 * on an origin that is in no OAuth registration and in no `BETTER_AUTH_URL`,
 * and therefore outside Better Auth's `trustedOrigins`. Refusing them is what
 * makes the split-origin guarantee structural instead of a thing an operator
 * remembers.
 *
 * It closes what the Worker serves, which is not quite the same as what the
 * hostname serves: static assets are matched ahead of the Worker and never
 * reach this function. See docs/domains.md — the auth surface is what this can
 * close, and it does.
 */
export type OriginDecision =
  | { action: "serve" }
  | { action: "redirect"; url: string }
  | { action: "refuse" };

const SERVE: OriginDecision = { action: "serve" };
const REFUSE: OriginDecision = { action: "refuse" };

/** Serve this request here, send it elsewhere, or refuse the origin outright. */
export function resolveOriginRequest({
  marketingUrl,
  appUrl,
  requestUrl,
}: ResolveOriginRequestInput): OriginDecision {
  // Single-origin mode. No topology has been declared, so there is none to
  // enforce: whatever hostname routed here is the app's, which is what keeps
  // `pnpm dev` on localhost and one-hostname deploys working with no config.
  if (!marketingUrl) return SERVE;

  const marketing = safeUrl(marketingUrl);
  const app = safeUrl(appUrl);
  const request = safeUrl(requestUrl);
  // A malformed binding must not take the site down one request at a time — and
  // refusing requires knowing both origins, so an unparseable one can only mean
  // serve.
  if (!marketing || !app || !request) return SERVE;

  // Misconfiguration guard, and the reason this cannot be an assertion: if both
  // variables name the same host, every rule below would redirect a host to
  // itself. That is an infinite loop serving nothing — strictly worse than the
  // single-origin behaviour we fall back to.
  //
  // Above the refusal, not below it, so the fallback is the whole of
  // single-origin behaviour rather than half of it. `MARKETING_URL` set to a
  // malformed value and `MARKETING_URL` set to the app's own host are the same
  // mistake wearing different clothes, and refusing on one while serving on the
  // other is a distinction nobody can act on. Concretely: with both variables
  // naming the app host, a marketing apex that is still in `routes` matches
  // neither origin, and refusing would 404 the public landing page over one
  // copy-pasted secret. A topology this self-contradictory has not been
  // declared, so there is none to enforce.
  if (marketing.host === app.host) return SERVE;

  const onApp = request.host === app.host;
  const onMarketing = request.host === marketing.host;

  // Neither origin: nobody declared this hostname, so nothing the Worker serves
  // answers on it.
  if (!onApp && !onMarketing) return REFUSE;

  const { pathname, search } = request;

  if (onMarketing && isAppPath(pathname)) {
    return { action: "redirect", url: `${app.origin}${pathname}${search}` };
  }

  // The landing page lives on exactly one origin. Without this it is reachable
  // at both, which is duplicate content to a search engine and an ambiguous
  // canonical URL to everyone else.
  if (onApp && pathname === "/") {
    return { action: "redirect", url: `${marketing.origin}/${search}` };
  }

  return SERVE;
}

/** Prefix match on a path segment boundary, so `/loginable` is not `/login`. */
export function isAppPath(pathname: string): boolean {
  return APP_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Bindings arrive as untyped strings; a malformed one must not throw per request. */
function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
