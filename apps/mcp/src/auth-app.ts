import { Hono } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import { createDb } from "@starter/db";
import { createAuth } from "@starter/auth/server";
import { APP_VERSION } from "@starter/config/version";
import { MCP_SERVER_NAME, PRODUCT_NAME } from "@starter/config/product";
import type { Env } from "./env";

type AuthEnv = { Bindings: Env };

/** The only scopes this server issues. Must match `scopesSupported` in index.ts. */
const SUPPORTED_SCOPES = ["mcp"] as const;

/** Scope granted when a client asks for none. */
const DEFAULT_SCOPE = [...SUPPORTED_SCOPES];

/**
 * Scopes the client asked for that this server does not issue.
 *
 * `scopesSupported` on `OAuthProvider` only populates discovery metadata — it is
 * not enforced during authorization. Without this check every requested scope is
 * granted verbatim, including ones that do not exist, so a token would carry
 * authority the server never meant to define.
 */
function unsupportedScopes(requested: readonly string[]): string[] {
  return requested.filter((scope) => !SUPPORTED_SCOPES.includes(scope as "mcp"));
}

/**
 * Why PKCE is enforced here rather than left to the library.
 *
 * `OAuthProvider` only *mandates* a code challenge when
 * `tokenEndpointAuthMethod === "none"`, and dynamic registration defaults to
 * `client_secret_basic` — so a client that registers without asking for the
 * public-client method can skip PKCE entirely, which OAuth 2.1 does not permit.
 * The missing-challenge branch is what closes that gap.
 *
 * The method check is defence in depth, not load-bearing today: verified that
 * `parseAuthRequest` already 400s both an explicit `plain` and an omitted
 * method, so only a missing challenge reaches here. Kept so a library change
 * cannot silently reintroduce a downgrade to `plain`.
 *
 * Returns a description of the problem, or null when the request is acceptable.
 */
function pkceProblem(oauthReq: AuthRequest): string | null {
  if (!oauthReq.codeChallenge) {
    return "code_challenge is required; this server requires PKCE for every client";
  }
  if (oauthReq.codeChallengeMethod !== "S256") {
    return `code_challenge_method must be S256, got ${oauthReq.codeChallengeMethod ?? "none"}`;
  }
  return null;
}

/**
 * Terminal OAuth error: hand the client a spec-shaped redirect rather than a
 * dead end.
 *
 * `iss` is required because the provider advertises
 * `authorization_response_iss_parameter_supported` (RFC 9207) — a conforming
 * client that sees it in discovery may reject a response that omits it, and
 * mixed-up-authorization-server defences depend on it being present on errors
 * too, not just on success.
 */
function oauthErrorRedirect(
  c: Context<AuthEnv>,
  oauthReq: AuthRequest,
  error: "access_denied" | "invalid_scope" | "invalid_request",
  description?: string,
): Response {
  const target = new URL(oauthReq.redirectUri);
  target.searchParams.set("error", error);
  if (description) target.searchParams.set("error_description", description);
  if (oauthReq.state) target.searchParams.set("state", oauthReq.state);

  const issuer = oauthReq.issuer ?? new URL(c.req.url).origin;
  if (issuer) target.searchParams.set("iss", issuer);

  return c.redirect(target.toString(), 302);
}

/**
 * Reject anything this server will not honour, before a user is asked to
 * approve it. One helper so the GET and POST paths cannot drift apart.
 */
function rejectUnacceptable(c: Context<AuthEnv>, oauthReq: AuthRequest): Response | null {
  const pkce = pkceProblem(oauthReq);
  if (pkce) return oauthErrorRedirect(c, oauthReq, "invalid_request", pkce);

  const bad = unsupportedScopes(oauthReq.scope);
  if (bad.length > 0) {
    return oauthErrorRedirect(c, oauthReq, "invalid_scope", `Unsupported scope: ${bad.join(" ")}`);
  }

  return null;
}

/**
 * Better Auth bound to *this* Worker's origin.
 *
 * The MCP Worker is a separate deploy unit from apps/web, so it cannot read the
 * web app's session cookie. It runs its own Better Auth instance against the
 * same D1 and the same secret — same users, separate session cookie scoped to
 * this origin. `baseURL` is derived from the request so dev and production both
 * work without another binding.
 */
function authFor(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB);
  return createAuth({
    db,
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: new URL(c.req.url).origin,
    // Without these, an account created through Google or GitHub has no way in:
    // it has no password, and the providers would be disabled on this Worker.
    githubClientId: c.env.GITHUB_CLIENT_ID,
    githubClientSecret: c.env.GITHUB_CLIENT_SECRET,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
  });
}

/**
 * A header-only copy of the request, for better-auth's CSRF middleware.
 *
 * Passing something for `request` is what arms `formCsrfMiddleware` at all — it
 * opens with `if (!ctx.request) return;`. But `c.req.raw` cannot be reused here:
 * its body has already been consumed by `c.req.formData()`. The middleware only
 * reads headers (Cookie, Origin, Referer, Sec-Fetch-*) to decide whether this is
 * a cross-site form post, so a bodyless copy carries everything it needs.
 */
function csrfRequest(c: Context<AuthEnv>): Request {
  return new Request(c.req.url, { method: c.req.method, headers: c.req.raw.headers });
}

const SOCIAL_INTENT = "social:";

type SocialProvider = "github" | "google";

/** Providers whose credentials are actually configured on this Worker. */
function enabledProviders(env: Env): Array<{ id: SocialProvider; label: string }> {
  const providers: Array<{ id: SocialProvider; label: string }> = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push({ id: "github", label: "GitHub" });
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({ id: "google", label: "Google" });
  }
  return providers;
}

export const authApp = new Hono<AuthEnv>();

// Better Auth's own routes — the login form posts through `/authorize`, but
// social callbacks and session endpoints need to be reachable directly.
authApp.on(["GET", "POST"], "/api/auth/**", (c) => authFor(c).handler(c.req.raw));

authApp.get("/", (c) =>
  c.json({ name: MCP_SERVER_NAME, version: APP_VERSION, authorization: "/authorize" }),
);

authApp.get("/authorize", async (c) => {
  const parsed = await parseRequest(c);
  if ("error" in parsed) return parsed.error;
  const { oauthReq, client } = parsed;

  // Reject before showing consent — never ask a user to approve a request this
  // server would not honour.
  const rejected = rejectUnacceptable(c, oauthReq);
  if (rejected) return rejected;

  const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  const search = new URL(c.req.url).search;

  return c.html(
    session
      ? consentPage({ client, oauthReq, email: session.user.email, search })
      : loginPage({ client, search, providers: enabledProviders(c.env) }),
  );
});

authApp.post("/authorize", async (c) => {
  const parsed = await parseRequest(c);
  if ("error" in parsed) return parsed.error;
  const { oauthReq, client } = parsed;

  // Re-checked on POST: the query string is caller-supplied on every request,
  // so passing the GET check is no guarantee this one is clean.
  const rejected = rejectUnacceptable(c, oauthReq);
  if (rejected) return rejected;

  const form = await c.req.formData();
  const intent = String(form.get("intent") ?? "");
  const url = new URL(c.req.url);
  const search = url.search;
  const auth = authFor(c);

  if (intent.startsWith(SOCIAL_INTENT)) {
    const provider = intent.slice(SOCIAL_INTENT.length) as SocialProvider;
    if (!enabledProviders(c.env).some((p) => p.id === provider)) {
      return c.html(loginPage({ client, search, providers: enabledProviders(c.env) }), 400);
    }

    // Hand control to the provider, telling Better Auth to land the user back on
    // /authorize with the original request intact so consent can resume.
    //
    // `asResponse` matters: better-auth sets a signed OAuth *state* cookie
    // alongside the redirect URL. Redirecting without forwarding that cookie
    // makes the provider callback fail with a state mismatch, which left social
    // sign-in completely non-functional — the only route in for an account that
    // has no password.
    const res = await auth.api
      .signInSocial({
        body: { provider, callbackURL: `${url.origin}/authorize${search}` },
        asResponse: true,
        request: csrfRequest(c),
      })
      .catch(() => null);

    const target = res?.ok
      ? ((await res.json().catch(() => null)) as { url?: string } | null)?.url
      : undefined;

    if (!res || !target) {
      return c.html(
        loginPage({
          client,
          search,
          providers: enabledProviders(c.env),
          error: `Could not start sign-in with ${provider}.`,
        }),
        502,
      );
    }

    const headers = new Headers({ location: target });
    for (const cookie of setCookiesOf(res)) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }

  if (intent === "login") {
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    // `request` is REQUIRED, not optional plumbing. better-auth's
    // formCsrfMiddleware opens with `if (!ctx.request) return;`, so calling
    // through auth.api.* without it silently disarms the very check that blocks
    // cross-site form logins. Without this an attacker page can auto-submit a
    // top-level POST here with their own credentials and plant their session in
    // the victim's browser — SameSite governs sending a cookie, not setting one
    // — after which the victim's Approve binds their MCP client to the
    // attacker's account.
    const res = await auth.api
      .signInEmail({ body: { email, password }, asResponse: true, request: csrfRequest(c) })
      .catch(() => null);

    if (!res || !res.ok) {
      return c.html(
        loginPage({
          client,
          search,
          providers: enabledProviders(c.env),
          error: "Invalid email or password.",
        }),
        401,
      );
    }

    // Carry Better Auth's session cookie onto the redirect back to /authorize.
    const headers = new Headers({ location: `/authorize${search}` });
    for (const cookie of setCookiesOf(res)) headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.html(loginPage({ client, search, providers: enabledProviders(c.env) }), 401);
  }

  if (intent !== "approve") {
    return oauthErrorRedirect(c, oauthReq, "access_denied");
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: session.user.id,
    metadata: { email: session.user.email },
    // Already validated above; grant only what this server actually defines.
    scope: oauthReq.scope.length ? oauthReq.scope : DEFAULT_SCOPE,
    // Handed to the Agent as `this.props` — the only identity a tool ever sees.
    props: { userId: session.user.id, email: session.user.email },
  });

  return c.redirect(redirectTo, 302);
});

/**
 * Read every `Set-Cookie` off a response.
 *
 * `getSetCookie()` exists in the Workers runtime but not in the pinned
 * `@cloudflare/workers-types`, so it is feature-detected. The fallback reads the
 * combined header, which is lossy for multiple cookies — fine here, since Better
 * Auth sets a single session cookie.
 */
function setCookiesOf(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = res.headers.get("set-cookie");
  return combined ? [combined] : [];
}

async function parseRequest(
  c: Context<AuthEnv>,
): Promise<{ oauthReq: AuthRequest; client: ClientInfo } | { error: Response }> {
  try {
    const oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
    if (!client) {
      return { error: c.text("Unknown OAuth client.", 400) };
    }
    return { oauthReq, client };
  } catch {
    return { error: c.text("Invalid authorization request.", 400) };
  }
}

// --- Views -----------------------------------------------------------------
// `html` escapes every interpolation. That matters here: client name and
// redirect URI come from dynamic registration and are attacker-controlled.

function layout(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          :root {
            color-scheme: light dark;
          }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: Canvas;
            color: CanvasText;
            font:
              15px/1.5 ui-sans-serif,
              system-ui,
              sans-serif;
          }
          .card {
            width: min(26rem, calc(100vw - 2rem));
            border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
            border-radius: 12px;
            padding: 1.75rem;
          }
          h1 {
            margin: 0 0 0.25rem;
            font-size: 1.15rem;
          }
          p.sub {
            margin: 0 0 1.25rem;
            color: color-mix(in srgb, CanvasText 60%, transparent);
          }
          label {
            display: block;
            margin-bottom: 0.85rem;
          }
          label span {
            display: block;
            margin-bottom: 0.3rem;
            font-size: 0.85rem;
          }
          input {
            width: 100%;
            box-sizing: border-box;
            padding: 0.5rem 0.65rem;
            border-radius: 8px;
            border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
            background: Canvas;
            color: CanvasText;
            font: inherit;
          }
          button {
            padding: 0.55rem 1rem;
            border-radius: 8px;
            border: 0;
            font: inherit;
            cursor: pointer;
          }
          button.primary {
            background: #2563eb;
            color: #fff;
            width: 100%;
          }
          .row {
            display: flex;
            gap: 0.6rem;
          }
          .row button {
            flex: 1;
          }
          button.secondary {
            background: color-mix(in srgb, CanvasText 10%, transparent);
            color: CanvasText;
          }
          .scopes {
            margin: 0 0 1.25rem;
            padding-left: 1.1rem;
          }
          code {
            font-family: ui-monospace, monospace;
            font-size: 0.85em;
            word-break: break-all;
          }
          .social {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
          .social button {
            width: 100%;
          }
          .divider {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin: 1.1rem 0;
            color: color-mix(in srgb, CanvasText 45%, transparent);
            font-size: 0.8rem;
          }
          .divider::before,
          .divider::after {
            content: "";
            flex: 1;
            height: 1px;
            background: color-mix(in srgb, CanvasText 15%, transparent);
          }
          .error {
            margin: 0 0 1rem;
            padding: 0.55rem 0.7rem;
            border-radius: 8px;
            background: color-mix(in srgb, #dc2626 15%, transparent);
            font-size: 0.9rem;
          }
        </style>
      </head>
      <body>
        <main class="card">${body}</main>
      </body>
    </html>`;
}

function clientLabel(client: ClientInfo): string {
  return client.clientName?.trim() || client.clientId;
}

function loginPage(opts: {
  client: ClientInfo;
  search: string;
  providers: Array<{ id: SocialProvider; label: string }>;
  error?: string;
}) {
  return layout(
    "Sign in",
    html`
      <h1>Sign in to ${PRODUCT_NAME}</h1>
      <p class="sub">
        ${clientLabel(opts.client)} wants to connect to your ${PRODUCT_NAME} account.
      </p>
      ${opts.error ? html`<p class="error">${opts.error}</p>` : ""}
      ${opts.providers.length > 0
        ? html`
            <form method="post" action="/authorize${opts.search}" class="social">
              ${opts.providers.map(
                (provider) => html`
                  <button
                    class="secondary"
                    type="submit"
                    name="intent"
                    value="social:${provider.id}"
                  >
                    Continue with ${provider.label}
                  </button>
                `,
              )}
            </form>
            <div class="divider"><span>or</span></div>
          `
        : ""}
      <form method="post" action="/authorize${opts.search}">
        <input type="hidden" name="intent" value="login" />
        <label>
          <span>Email</span>
          <input type="email" name="email" autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <button class="primary" type="submit">Sign in</button>
      </form>
    `,
  );
}

function consentPage(opts: {
  client: ClientInfo;
  oauthReq: AuthRequest;
  email: string;
  search: string;
}) {
  const scopes = opts.oauthReq.scope.length ? opts.oauthReq.scope : DEFAULT_SCOPE;
  return layout(
    "Authorize",
    html`
      <h1>Authorize ${clientLabel(opts.client)}</h1>
      <p class="sub">Access your ${PRODUCT_NAME} account as ${opts.email}</p>
      <ul class="scopes">
        ${scopes.map((scope) => html`<li><code>${scope}</code></li>`)}
      </ul>
      <p class="sub">Redirects to <code>${opts.oauthReq.redirectUri}</code></p>
      <form method="post" action="/authorize${opts.search}">
        <div class="row">
          <button class="secondary" type="submit" name="intent" value="deny">Deny</button>
          <button class="primary" type="submit" name="intent" value="approve">Approve</button>
        </div>
      </form>
    `,
  );
}
