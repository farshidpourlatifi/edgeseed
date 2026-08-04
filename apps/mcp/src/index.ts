import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { withSentry } from "@sentry/cloudflare";
import { sentryOptions } from "@starter/observability";
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

export default withSentry<Env>(sentryOptions, oauthProvider);
