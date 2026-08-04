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
const oauthProvider = new OAuthProvider<Env>({
  apiRoute: ["/mcp", "/sse"],
  apiHandler: {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);
      const path = url.pathname === "/sse" || url.pathname === "/sse/message" ? "/sse" : "/mcp";
      return StarterMcpAgent.serve(path).fetch(request, env, ctx);
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
