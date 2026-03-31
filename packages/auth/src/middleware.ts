import { createMiddleware } from "hono/factory";
import { createDb, type Database } from "@starter/db";
import { createAuth, type Auth } from "./server";

export interface AuthEnv {
  Bindings: {
    DB: D1Database;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ENVIRONMENT: string;
  };
  Variables: {
    db: Database;
    auth: Auth;
  };
}

/** Hono middleware that creates db + auth per request and stores on context */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const auth = createAuth({
    db,
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: c.env.BETTER_AUTH_URL,
  });
  c.set("db", db);
  c.set("auth", auth);
  await next();
});
