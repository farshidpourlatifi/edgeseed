import { Hono } from "hono";
import { authMiddleware } from "@starter/auth/middleware";
import { principalMiddleware, type ApiPrincipal } from "@starter/auth";
import {
  observabilityErrorHandler,
  observabilityMiddleware,
  type ObservabilityEnv,
} from "@starter/observability/middleware";
import { apiApp } from "./api";
import { resolveOriginRedirect } from "./origins";

export interface ServerEnv {
  Bindings: ObservabilityEnv["Bindings"] & {
    DB: D1Database;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ENVIRONMENT: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    /** Marketing origin. Unset ⇒ one origin serves everything (docs/domains.md). */
    MARKETING_URL?: string;
  };
  Variables: ObservabilityEnv["Variables"] & {
    db: import("@starter/db").Database;
    auth: import("@starter/auth").Auth;
    principal: ApiPrincipal | null;
  };
}

const app = new Hono<ServerEnv>();

// Request logger + correlation id. Mounted first so everything below is
// covered, including failures inside authMiddleware itself.
app.use(observabilityMiddleware);

// Split-origin topology, when configured. Mounted before authMiddleware on
// purpose: an app path arriving on the marketing origin leaves as a redirect
// without ever constructing an auth instance there, so the guarantee that auth
// only runs on one origin is structural rather than a convention. No-op unless
// MARKETING_URL is set — see docs/domains.md.
app.use(async (c, next) => {
  const target = resolveOriginRedirect({
    marketingUrl: c.env.MARKETING_URL,
    appUrl: c.env.BETTER_AUTH_URL,
    requestUrl: c.req.url,
  });
  if (target) return c.redirect(target, 302);
  await next();
});

// Create db + auth per request
app.use(authMiddleware);

// Mount Better Auth handler
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return c.get("auth").handler(c.req.raw);
});

// Resolve a bearer token or session into a principal for the versioned API.
// Scoped to /api/v1 so Better Auth's own routes keep owning their credentials.
app.use("/api/v1/*", principalMiddleware);

// Mount versioned API routes
app.route("/api/v1", apiApp);

// Log + report anything that escapes a handler, and answer with the request id
app.onError(observabilityErrorHandler);

export default app;
