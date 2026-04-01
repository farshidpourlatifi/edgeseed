import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { Database } from "@starter/db";

export interface CreateAuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  githubClientId?: string;
  githubClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  waitUntil?: (p: Promise<unknown>) => void;
}

/** Create a Better Auth instance configured for D1 + Drizzle */
export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(opts.db, { provider: "sqlite" }),
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      ...(opts.githubClientId && opts.githubClientSecret
        ? {
            github: {
              clientId: opts.githubClientId,
              clientSecret: opts.githubClientSecret,
            },
          }
        : {}),
      ...(opts.googleClientId && opts.googleClientSecret
        ? {
            google: {
              clientId: opts.googleClientId,
              clientSecret: opts.googleClientSecret,
            },
          }
        : {}),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
