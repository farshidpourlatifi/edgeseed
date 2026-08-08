import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { PrincipalEnv } from "@starter/auth";
import { PRODUCT_NAME } from "@starter/config/product";
import { APP_VERSION } from "@starter/config/version";
import { apiApp } from "../api";

describe("GET /health", () => {
  it("reports ok with the app version", async () => {
    const res = await apiApp.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", version: APP_VERSION });
  });
});

describe("GET /doc", () => {
  it("serves the OpenAPI 3.1 spec", async () => {
    const res = await apiApp.request("/doc");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    // Derived, never a literal — `init:product` rewrites `PRODUCT_NAME` in every
    // downstream clone, and a hardcoded title would fail there permanently.
    expect(spec.info.title).toBe(`${PRODUCT_NAME} API`);
    expect(spec.info.version).toBe(APP_VERSION);
    expect(Object.keys(spec.paths)).toContain("/health");
  });
});

describe("unknown routes", () => {
  // 401 rather than 404 to an anonymous caller: the default-deny guard runs
  // before routing resolves, so it cannot know the route is absent — and not
  // answering means the surface cannot be enumerated without credentials.
  it("401s outside the defined surface when anonymous", async () => {
    const res = await apiApp.request("/nope");
    expect(res.status).toBe(401);
  });

  it("404s outside the defined surface once authenticated", async () => {
    const app = new Hono<PrincipalEnv>();
    app.use(async (c, next) => {
      c.set("principal", { userId: "user_1", organizationId: null, via: "session" });
      await next();
    });
    app.route("/", apiApp);

    const res = await app.request("/nope", { headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(404);
  });
});
