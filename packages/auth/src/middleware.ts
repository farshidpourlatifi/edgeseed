import { createMiddleware } from "hono/factory";
import { parseEnv, webEnvSchema } from "@starter/config/env";
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

/**
 * Hono middleware that creates db + auth per request and stores on context.
 *
 * Validates the bindings first and lets a bad env throw. That throw is the
 * point: `observabilityErrorHandler` turns it into a 500 with a correlation id,
 * so a Worker deployed without `BETTER_AUTH_SECRET` serves nothing instead of
 * serving sessions signed with a publicly-known constant. Fail closed, loudly.
 *
 * Parsing per request rather than once at module init because Workers only hand
 * `env` to the request handler — there is no init-time env to validate. A Zod
 * parse of ~15 fields is immaterial next to the D1 round trips that follow.
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  // The parsed result, not `c.env` — so ENVIRONMENT's default applies here the
  // same way it does everywhere else that reads the schema.
  const env = parseEnv(webEnvSchema, c.env);

  const db = createDb(env.DB);
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Request-scoped, so a dropped email carries this request's correlation id.
    email: createEmailSender({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      environment: env.ENVIRONMENT,
      logger: c.get("logger"),
    }),
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  c.set("db", db);
  c.set("auth", auth);
  await next();
});
