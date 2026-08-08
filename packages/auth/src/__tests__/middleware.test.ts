import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createFakeEnv } from "@starter/testing/fake-env";
import { authMiddleware, type AuthEnv } from "../middleware";

/**
 * `middleware.ts` has no unit coverage target — it is a thin config wrapper
 * exercised by `tests/e2e/auth.spec.ts`. These tests exist anyway because
 * validating the env turned it into a guard, and a guard ships its deny path.
 *
 * Only the deny path is asserted here. The allow path constructs a real Better
 * Auth instance, which is what the e2e suite already proves end to end.
 */

/** Captures whatever escapes the middleware, so we can assert on the cause. */
function appWith() {
  const app = new Hono<AuthEnv>();
  const errors: unknown[] = [];

  // authMiddleware requires a logger on the context; observabilityMiddleware
  // supplies it in the real chain (the type makes that ordering non-optional).
  app.use(async (c, next) => {
    c.set("logger", { warn: vi.fn(), error: vi.fn() } as unknown as AuthEnv["Variables"]["logger"]);
    await next();
  });
  app.use(authMiddleware);
  app.get("/thing", (c) => c.text("reached"));
  app.onError((err, c) => {
    errors.push(err);
    return c.text("failed", 500);
  });

  return { app, errors };
}

describe("authMiddleware env validation", () => {
  it("refuses the request when BETTER_AUTH_SECRET is missing", async () => {
    const { app, errors } = appWith();

    const res = await app.request("/thing", {}, createFakeEnv({ BETTER_AUTH_SECRET: undefined }));

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
  });

  // The case that reaches production silently today: Better Auth falls back to
  // this constant and only warns, so without the schema it signs real sessions.
  it("refuses the request when the secret is Better Auth's default", async () => {
    const { app, errors } = appWith();

    const res = await app.request(
      "/thing",
      {},
      createFakeEnv({ BETTER_AUTH_SECRET: "better-auth-secret-12345678901234567890" }),
    );

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
  });

  it("refuses the request when the secret is too short", async () => {
    const { app } = appWith();

    const res = await app.request("/thing", {}, createFakeEnv({ BETTER_AUTH_SECRET: "short" }));

    expect(res.status).toBe(500);
  });

  // Failing closed means the handler never runs — not that it runs degraded.
  it("never reaches the route handler on a bad env", async () => {
    const { app } = appWith();

    const res = await app.request("/thing", {}, createFakeEnv({ BETTER_AUTH_SECRET: undefined }));

    await expect(res.text()).resolves.not.toBe("reached");
  });
});
