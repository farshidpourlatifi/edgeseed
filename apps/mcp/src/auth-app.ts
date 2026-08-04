import { Hono } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import { createDb } from "@starter/db";
import { createAuth } from "@starter/auth/server";
import { APP_VERSION } from "@starter/config/version";
import type { Env } from "./env";

type AuthEnv = { Bindings: Env };

/** Scope granted when a client asks for none. */
const DEFAULT_SCOPE = ["mcp"];

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
  });
}

export const authApp = new Hono<AuthEnv>();

// Better Auth's own routes — the login form posts through `/authorize`, but
// social callbacks and session endpoints need to be reachable directly.
authApp.on(["GET", "POST"], "/api/auth/**", (c) => authFor(c).handler(c.req.raw));

authApp.get("/", (c) =>
  c.json({ name: "Starter MCP Server", version: APP_VERSION, authorization: "/authorize" }),
);

authApp.get("/authorize", async (c) => {
  const parsed = await parseRequest(c);
  if ("error" in parsed) return parsed.error;
  const { oauthReq, client } = parsed;

  const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  const search = new URL(c.req.url).search;

  return c.html(
    session
      ? consentPage({ client, oauthReq, email: session.user.email, search })
      : loginPage({ client, search }),
  );
});

authApp.post("/authorize", async (c) => {
  const parsed = await parseRequest(c);
  if ("error" in parsed) return parsed.error;
  const { oauthReq, client } = parsed;

  const form = await c.req.formData();
  const intent = String(form.get("intent") ?? "");
  const search = new URL(c.req.url).search;
  const auth = authFor(c);

  if (intent === "login") {
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const res = await auth.api
      .signInEmail({ body: { email, password }, asResponse: true })
      .catch(() => null);

    if (!res || !res.ok) {
      return c.html(loginPage({ client, search, error: "Invalid email or password." }), 401);
    }

    // Carry Better Auth's session cookie onto the redirect back to /authorize.
    const headers = new Headers({ location: `/authorize${search}` });
    for (const cookie of setCookiesOf(res)) headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.html(loginPage({ client, search }), 401);

  if (intent !== "approve") {
    // Denied — hand the client the spec's error rather than a dead end.
    const denied = new URL(oauthReq.redirectUri);
    denied.searchParams.set("error", "access_denied");
    if (oauthReq.state) denied.searchParams.set("state", oauthReq.state);
    return c.redirect(denied.toString(), 302);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: session.user.id,
    metadata: { email: session.user.email },
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

function loginPage(opts: { client: ClientInfo; search: string; error?: string }) {
  return layout(
    "Sign in",
    html`
      <h1>Sign in</h1>
      <p class="sub">${clientLabel(opts.client)} wants to connect to your account.</p>
      ${opts.error ? html`<p class="error">${opts.error}</p>` : ""}
      <form method="post" action="/authorize${opts.search}">
        <input type="hidden" name="intent" value="login" />
        <label>
          <span>Email</span>
          <input type="email" name="email" autocomplete="username" required autofocus />
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
      <p class="sub">Signed in as ${opts.email}</p>
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
