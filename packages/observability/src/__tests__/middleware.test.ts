import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  observabilityErrorHandler,
  observabilityMiddleware,
  setRequestIdHeader,
  type ObservabilityEnv,
} from "../middleware";
import { REQUEST_ID_HEADER } from "../request-id";

type ConsoleEntry = Record<string, unknown>;

let logs: ConsoleEntry[];
let spies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  logs = [];
  const capture = (entry: unknown) => {
    logs.push(entry as ConsoleEntry);
  };
  spies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(capture),
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

function appWith(handler: Parameters<Hono<ObservabilityEnv>["get"]>[1]) {
  const app = new Hono<ObservabilityEnv>();
  app.use(observabilityMiddleware);
  app.get("/thing", handler);
  return app;
}

const ENV = { ENVIRONMENT: "development" };

describe("observabilityMiddleware", () => {
  it("logs request start and completion with method, path, status and duration", async () => {
    const app = appWith((c) => c.text("ok"));
    const res = await app.request("/thing", {}, ENV);

    expect(res.status).toBe(200);
    expect(logs.map((entry) => entry.msg)).toEqual(["request.start", "request.complete"]);
    expect(logs[1]).toMatchObject({
      level: "info",
      method: "GET",
      path: "/thing",
      status: 200,
    });
    expect(logs[1].durationMs).toBeTypeOf("number");
  });

  it("exposes a request-scoped logger and id on the context", async () => {
    const app = appWith((c) => {
      c.get("logger").info("handler.ran");
      return c.text(c.get("requestId"));
    });

    const res = await app.request("/thing", { headers: { [REQUEST_ID_HEADER]: "req-1" } }, ENV);

    await expect(res.text()).resolves.toBe("req-1");
    const handlerLog = logs.find((entry) => entry.msg === "handler.ran");
    expect(handlerLog).toMatchObject({ requestId: "req-1", method: "GET", path: "/thing" });
  });

  it("echoes the correlation id on the response", async () => {
    const app = appWith((c) => c.text("ok"));
    const res = await app.request("/thing", { headers: { [REQUEST_ID_HEADER]: "req-2" } }, ENV);

    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-2");
  });

  it("stamps every entry with the environment and app version", async () => {
    const app = appWith((c) => c.text("ok"));
    await app.request("/thing", {}, ENV);

    expect(logs[0]).toMatchObject({ env: "development" });
    expect(logs[0].version).toBeTypeOf("string");
  });

  it("still logs when the Worker env is absent entirely", async () => {
    const app = appWith((c) => c.text("ok"));
    await app.request("/thing");

    expect(logs.at(-1)).toMatchObject({ msg: "request.complete", env: "development" });
  });

  it("logs 4xx responses at warn and 5xx at error", async () => {
    const notFound = new Hono<ObservabilityEnv>();
    notFound.use(observabilityMiddleware);
    await notFound.request("/missing", {}, ENV);
    expect(logs.at(-1)).toMatchObject({ level: "warn", status: 404 });

    logs = [];
    const broken = appWith((c) => c.text("nope", 503));
    await broken.request("/thing", {}, ENV);
    expect(logs.at(-1)).toMatchObject({ level: "error", status: 503 });
  });

  // Hono's default error handler turns a throw into a 500 before it unwinds
  // here, so the middleware still records the outcome even with no onError.
  it("records a 500 outcome when the app registers no onError", async () => {
    const app = appWith(() => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/thing", {}, ENV);

    expect(res.status).toBe(500);
    expect(logs.at(-1)).toMatchObject({ level: "error", msg: "request.complete", status: 500 });
  });
});

describe("setRequestIdHeader", () => {
  it("sets the header on a normal response", () => {
    const res = new Response("ok");
    setRequestIdHeader(res, "req-1");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-1");
  });

  // Redirects and fetch results have immutable headers — best-effort, never fatal.
  it("swallows the failure when headers are immutable", () => {
    const res = Response.redirect("https://example.com", 302);
    expect(() => setRequestIdHeader(res, "req-1")).not.toThrow();
  });
});

describe("observabilityErrorHandler", () => {
  function brokenApp(handler: () => never) {
    const app = new Hono<ObservabilityEnv>();
    app.use(observabilityMiddleware);
    app.get("/thing", handler);
    app.onError(observabilityErrorHandler);
    return app;
  }

  it("answers 500 with the correlation id in body and header", async () => {
    const app = brokenApp(() => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/thing", { headers: { [REQUEST_ID_HEADER]: "req-9" } }, ENV);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal Server Error",
      requestId: "req-9",
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-9");
  });

  it("logs the failure with the error detail", async () => {
    const app = brokenApp(() => {
      throw new Error("handler exploded");
    });

    await app.request("/thing", {}, ENV);

    const failure = logs.find((entry) => entry.msg === "request.failed");
    expect(failure).toMatchObject({ level: "error", status: 500 });
    expect(failure?.error).toMatchObject({ message: "handler exploded" });
  });

  it("never leaks the internal error message to the client", async () => {
    const app = brokenApp(() => {
      throw new Error("SELECT * FROM users WHERE token = 'sk-live-abc'");
    });

    const res = await app.request("/thing", {}, ENV);

    await expect(res.text()).resolves.not.toContain("sk-live-abc");
  });

  it("passes an HTTPException through at its own status, logged as a rejection", async () => {
    const app = brokenApp(() => {
      throw new HTTPException(403, { message: "Forbidden" });
    });

    const res = await app.request("/thing", {}, ENV);

    expect(res.status).toBe(403);
    expect(logs.find((entry) => entry.msg === "request.rejected")).toMatchObject({
      level: "warn",
      status: 403,
    });
    expect(logs.find((entry) => entry.msg === "request.failed")).toBeUndefined();
  });

  it("respects LOG_LEVEL, dropping debug entries", async () => {
    const app = appWith((c) => c.text("ok"));
    await app.request("/thing", {}, { ENVIRONMENT: "production", LOG_LEVEL: "warn" });

    expect(logs.map((entry) => entry.msg)).toEqual([]);
  });

  it("defaults to info outside development, so request.start is dropped", async () => {
    const app = appWith((c) => c.text("ok"));
    await app.request("/thing", {}, { ENVIRONMENT: "production" });

    expect(logs.map((entry) => entry.msg)).toEqual(["request.complete"]);
  });
});
