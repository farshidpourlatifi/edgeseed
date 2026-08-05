import { z } from "zod";

/** Shared bindings available to all apps */
const sharedEnvSchema = z.object({
  DB: z.custom<D1Database>((v) => v != null, "D1 binding required"),
  BETTER_AUTH_SECRET: z.string().min(32),
  ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // --- Observability (all optional: logging works standalone, Sentry is opt-in) ---
  /** Absent/empty disables Sentry entirely — `withSentry` becomes a pass-through. */
  SENTRY_DSN: z.string().optional(),
  /** Overrides ENVIRONMENT for the Sentry `environment` tag. */
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** Overrides APP_VERSION for the Sentry `release` tag. */
  SENTRY_RELEASE: z.string().optional(),
  /** Fraction of requests traced, 0..1. Bindings arrive as strings. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  /** Overrides the level derived from ENVIRONMENT. */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

/** Web app Worker bindings */
export const webEnvSchema = sharedEnvSchema.extend({
  /** Public origin. Required only here — the MCP Worker derives its origin per request. */
  BETTER_AUTH_URL: z.string().url(),
});

/** MCP server Worker bindings — no BETTER_AUTH_URL: `baseURL` derives from the request origin. */
export const mcpEnvSchema = sharedEnvSchema.extend({});

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type McpEnv = z.infer<typeof mcpEnvSchema>;

/** Parse and validate Worker env bindings */
export function parseEnv<T extends z.ZodType>(schema: T, env: unknown): z.infer<T> {
  return schema.parse(env);
}
