import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { withSentry } from "@sentry/cloudflare";
import { APP_VERSION } from "@starter/config/version";
import {
  bindSentryRequestScope,
  consoleWriter,
  createLogger,
  REQUEST_ID_HEADER,
  resolveLogLevel,
  resolveRequestId,
  sentryOptions,
  withSentryBreadcrumbs,
} from "@starter/observability";
import { StarterMcpAgent } from "./agent";
import { authApp } from "./auth-app";
import type { Env } from "./env";

export { StarterMcpAgent };

/**
 * OAuth 2.1 in front of the MCP surface.
 *
 * `apiRoute` paths require a valid bearer token — an unauthenticated request
 * gets a 401 carrying the `WWW-Authenticate` challenge that MCP clients follow
 * to discovery, dynamic registration (`/register`), and the consent screen.
 * Everything else falls through to `authApp` (login, consent, Better Auth).
 *
 * Grants and tokens live in OAUTH_KV; the user records they point at live in
 * the same D1 as apps/web.
 */
/** How long a session id stays bound to its principal. */
const SESSION_OWNER_TTL_SECONDS = 60 * 60 * 24;

/**
 * Bind an MCP session id to the principal that created it, and reject any later
 * request that presents the same id as a different user.
 *
 * The Durable Object is named `streamable-http:${sessionId}` from the
 * client-supplied `mcp-session-id` header, and the Agent's `props` are written
 * to DO storage during `onStart` — set once, then restored on every restart, so
 * they are never refreshed per request. Without this check, anyone who learns a
 * session id (the MCP spec treats it as non-secret) could present their *own*
 * valid bearer token with a victim's session id and have every tool resolve to
 * the victim's `userId`.
 *
 * Neither obvious fix works here: reading `this.props` per call still reads the
 * stored value, and the id cannot be namespaced by user because the SDK
 * generates it during `initialize` — the request that creates the DO. So the
 * binding is enforced at the edge, which is the last point we control.
 *
 * Costs one KV read per MCP request. `expirationTtl` keeps the namespace from
 * growing without bound; a returning client past the TTL simply rebinds.
 */
async function enforceSessionOwner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const sessionId = request.headers.get("mcp-session-id");
  const userId = (ctx as ExecutionContext & { props?: { userId?: string } }).props?.userId;

  // No session yet (initialize) or no principal — OAuthProvider has already
  // rejected unauthenticated callers before this handler runs.
  if (!sessionId || !userId) return null;

  const key = `mcp-session-owner:${sessionId}`;
  const owner = await env.OAUTH_KV.get(key);

  if (owner === null) {
    await env.OAUTH_KV.put(key, userId, { expirationTtl: SESSION_OWNER_TTL_SECONDS });
    return null;
  }

  if (owner !== userId) {
    return new Response(JSON.stringify({ error: "session_principal_mismatch" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  return null;
}

const oauthProvider = new OAuthProvider<Env>({
  // Streamable HTTP only. `serve()` defaults to `transport: "streamable-http"`,
  // so the previous `/sse` special-case never actually served SSE — GET /sse
  // 400'd asking for a session header and POST /sse/message 404'd. Rather than
  // ship a second transport nothing exercises, the route is gone; add it back
  // with `serve(path, { transport: "sse" })` if a client needs it.
  apiRoute: ["/mcp"],
  apiHandler: {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const denied = await enforceSessionOwner(request, env, ctx);
      if (denied) return denied;
      return StarterMcpAgent.serve("/mcp").fetch(request, env, ctx);
    },
  },
  defaultHandler: authApp,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
});

/**
 * Structured request logging around the whole provider.
 *
 * This wrapper is what gives the MCP Worker the same `request.start` /
 * `request.complete` lines as apps/web. `OAuthProvider` owns the fetch entry
 * point, so there is no middleware seam to hang this on — it has to wrap.
 */
const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = resolveRequestId(request.headers);

    const logger = createLogger({
      level: resolveLogLevel(env),
      base: {
        requestId,
        env: env.ENVIRONMENT ?? "development",
        version: APP_VERSION,
        app: "mcp",
      },
      write: withSentryBreadcrumbs(consoleWriter),
    }).child({ method: request.method, path: url.pathname });

    bindSentryRequestScope({ requestId, method: request.method, path: url.pathname });

    const start = Date.now();
    logger.debug("request.start");

    try {
      const response = await oauthProvider.fetch(request, env, ctx);
      const fields = { status: response.status, durationMs: Date.now() - start };

      if (response.status >= 500) logger.error("request.complete", fields);
      else if (response.status >= 400) logger.warn("request.complete", fields);
      else logger.info("request.complete", fields);

      try {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      } catch {
        // Immutable headers (redirects) — the id is best-effort on the wire.
      }
      return response;
    } catch (error) {
      logger.error("request.failed", { durationMs: Date.now() - start, error });
      // Rethrow so withSentry captures it with the scope bound above.
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

export default withSentry<Env>(sentryOptions, handler);
