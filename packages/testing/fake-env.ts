import { createFakeKv } from "./fake-kv";
import { createFakeRateLimiters } from "./fake-rate-limit";

/** Create a mock Worker env for testing */
export function createFakeEnv(overrides?: Record<string, unknown>) {
  return {
    DB: {} as D1Database,
    // Only `mcpEnvSchema` requires this; the web schema ignores the extra key,
    // so one fake env still serves both.
    OAUTH_KV: createFakeKv(),
    // Required bindings since audit #4: `parseEnv` refuses an env without them,
    // so every test that boots a Worker chain needs them present. Unlimited by
    // default — see `fake-rate-limit.ts`.
    ...createFakeRateLimiters(),
    BETTER_AUTH_SECRET: "test-secret-must-be-at-least-32-chars!!",
    BETTER_AUTH_URL: "http://localhost:5173",
    ENVIRONMENT: "development" as const,
    ...overrides,
  };
}
