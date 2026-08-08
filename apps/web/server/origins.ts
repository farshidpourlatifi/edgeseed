/**
 * Optional split-origin topology: marketing site on one hostname, the
 * application on another.
 *
 * Off by default. With `MARKETING_URL` unset the resolver returns `null` for
 * every request and the app behaves exactly as it always has — one origin
 * serving the landing page and the product together, which is what works on
 * `localhost:5173` with no configuration at all. Same idiom as `SENTRY_DSN`
 * and `RESEND_API_KEY`: absent means the simpler thing.
 *
 * Set it and the two origins separate. See docs/domains.md.
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

export interface ResolveOriginRedirectInput {
  /** `MARKETING_URL`. Undefined/empty ⇒ single-origin mode. */
  marketingUrl: string | undefined;
  /** `BETTER_AUTH_URL` — the app origin by definition, since auth pins it. */
  appUrl: string;
  /** The full request URL. */
  requestUrl: string;
}

/**
 * The absolute URL this request should be redirected to, or `null` to serve it
 * here.
 */
export function resolveOriginRedirect({
  marketingUrl,
  appUrl,
  requestUrl,
}: ResolveOriginRedirectInput): string | null {
  if (!marketingUrl) return null;

  const marketing = safeUrl(marketingUrl);
  const app = safeUrl(appUrl);
  const request = safeUrl(requestUrl);
  if (!marketing || !app || !request) return null;

  // Misconfiguration guard, and the reason this cannot be an assertion: if both
  // variables name the same host, every rule below would redirect a host to
  // itself. That is an infinite loop serving nothing — strictly worse than the
  // single-origin behaviour we fall back to.
  if (marketing.host === app.host) return null;

  const { pathname, search } = request;

  if (request.host === marketing.host && isAppPath(pathname)) {
    return `${app.origin}${pathname}${search}`;
  }

  // The landing page lives on exactly one origin. Without this it is reachable
  // at both, which is duplicate content to a search engine and an ambiguous
  // canonical URL to everyone else.
  if (request.host === app.host && pathname === "/") {
    return `${marketing.origin}/${search}`;
  }

  return null;
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
