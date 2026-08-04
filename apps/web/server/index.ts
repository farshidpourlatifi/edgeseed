import { Hono } from "hono";
import { authMiddleware } from "@starter/auth/middleware";
import {
  observabilityErrorHandler,
  observabilityMiddleware,
  type ObservabilityEnv,
} from "@starter/observability/middleware";
import { apiApp } from "./api";

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
  };
  Variables: ObservabilityEnv["Variables"] & {
    db: import("@starter/db").Database;
    auth: import("@starter/auth").Auth;
  };
}

const app = new Hono<ServerEnv>();

// Request logger + correlation id. Mounted first so everything below is
// covered, including failures inside authMiddleware itself.
app.use(observabilityMiddleware);

// Create db + auth per request
app.use(authMiddleware);

// Mount Better Auth handler
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return c.get("auth").handler(c.req.raw);
});

// Mount versioned API routes
app.route("/api/v1", apiApp);

// Log + report anything that escapes a handler, and answer with the request id
app.onError(observabilityErrorHandler);

export default app;
