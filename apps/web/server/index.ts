import { Hono } from "hono";
import { authMiddleware } from "@starter/auth/middleware";
import { apiApp } from "./api";

export interface ServerEnv {
  Bindings: {
    DB: D1Database;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ENVIRONMENT: string;
  };
  Variables: {
    db: import("@starter/db").Database;
    auth: import("@starter/auth").Auth;
  };
}

const app = new Hono<ServerEnv>();

// Create db + auth per request
app.use(authMiddleware);

// Mount Better Auth handler
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return c.get("auth").handler(c.req.raw);
});

// Mount versioned API routes
app.route("/api/v1", apiApp);

export default app;
