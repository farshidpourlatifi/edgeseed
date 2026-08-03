import { describe, it, expect } from "vitest";
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
    expect(spec.info.title).toBe("Starter API");
    expect(spec.info.version).toBe(APP_VERSION);
    expect(Object.keys(spec.paths)).toContain("/health");
  });
});

describe("unknown routes", () => {
  it("404s outside the defined surface", async () => {
    const res = await apiApp.request("/nope");
    expect(res.status).toBe(404);
  });
});
