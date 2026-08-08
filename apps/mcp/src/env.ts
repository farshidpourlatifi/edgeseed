import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { SentryEnv } from "@starter/observability";

/** Worker bindings for the MCP server. Mirrors `mcpEnvSchema` in @starter/config. */
export interface Env extends SentryEnv {
  DB: D1Database;
  /** Grant + token storage for the OAuth provider. */
  OAUTH_KV: KVNamespace;
  /**
   * Not a wrangler binding — `OAuthProvider` injects this into `env` at runtime
   * before invoking any handler.
   */
  OAUTH_PROVIDER: OAuthHelpers;
  BETTER_AUTH_SECRET: string;
  ENVIRONMENT: string;
  LOG_LEVEL?: string;
  /**
   * Social login on the consent screen. Needed as their own copies here: this
   * Worker runs its own Better Auth instance, and an account created through
   * Google has no password to fall back on.
   *
   * Each provider's authorized redirect URI must include THIS origin's
   * `/api/auth/callback/<provider>` — the web app's registration does not cover it.
   */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Transactional email. Unused today — this Worker has no signup or reset
   * screen — but `createAuth` takes a transport, and the bindings are shared
   * with apps/web through `sharedEnvSchema`.
   */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}
