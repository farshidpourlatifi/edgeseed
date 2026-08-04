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
  BETTER_AUTH_URL: string;
  ENVIRONMENT: string;
  LOG_LEVEL?: string;
}
