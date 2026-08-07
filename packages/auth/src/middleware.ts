import { createMiddleware } from "hono/factory";
import { createDb, type Database } from "@starter/db";
import { createEmailSender, type EmailLogger } from "@starter/email";
import { createAuth, type Auth } from "./server";

export interface AuthEnv {
  Bindings: {
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
  };
  Variables: {
    db: Database;
    auth: Auth;
    /**
     * Set by `observabilityMiddleware`, which must be mounted before this one
     * (see `apps/web/server/index.ts`). Required rather than optional so the
     * ordering dependency is a type error instead of a `console` fallback that
     * would bypass `redact()`.
     *
     * Typed as the narrowest shape this package uses, not `Logger` — that would
     * make `@starter/auth` depend on `@starter/observability` for one type it
     * only forwards.
     */
    logger: EmailLogger;
  };
}

/** Hono middleware that creates db + auth per request and stores on context */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const auth = createAuth({
    db,
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: c.env.BETTER_AUTH_URL,
    // Request-scoped, so a dropped email carries this request's correlation id.
    email: createEmailSender({
      apiKey: c.env.RESEND_API_KEY,
      from: c.env.EMAIL_FROM,
      environment: c.env.ENVIRONMENT,
      logger: c.get("logger"),
    }),
    githubClientId: c.env.GITHUB_CLIENT_ID,
    githubClientSecret: c.env.GITHUB_CLIENT_SECRET,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
  });
  c.set("db", db);
  c.set("auth", auth);
  await next();
});
