import { createMiddleware } from "hono/factory";
import { createDb, type Database } from "@starter/db";
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
    githubClientId: c.env.GITHUB_CLIENT_ID,
    githubClientSecret: c.env.GITHUB_CLIENT_SECRET,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
  });
  c.set("db", db);
  c.set("auth", auth);
  await next();
});
