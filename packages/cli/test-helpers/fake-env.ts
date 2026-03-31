/** Create a mock Worker env for testing */
export function createFakeEnv(overrides?: Record<string, unknown>) {
  return {
    DB: {} as D1Database,
    BETTER_AUTH_SECRET: "test-secret-must-be-at-least-32-chars!!",
    BETTER_AUTH_URL: "http://localhost:5173",
    ENVIRONMENT: "development" as const,
    ...overrides,
  };
}
