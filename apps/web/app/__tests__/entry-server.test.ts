/**
 * Deny-path tests for `handleError` — the guard that keeps expected 4xx out of
 * Sentry. The allow path (real failures get captured) is asserted alongside so
 * the `status < 500` boundary is pinned from both sides.
 *
 * Sentry is mocked because `captureError` silently no-ops without a client;
 * the logger uses the real `createLogger` with an injected sink, per the
 * observability package's own testing convention.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppLoadContext } from "react-router";
import { createLogger, type LogEntry } from "@starter/observability";

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock("@starter/observability/sentry", () => ({ captureError }));

const { handleError } = await import("../entry.server");

/** Shape react-router's isRouteErrorResponse duck-types against. */
function routeErrorResponse(status: number, data = "Not Found") {
  return { status, statusText: "Error", internal: true, data };
}

function makeContext(entries: LogEntry[]): AppLoadContext {
  return {
    logger: createLogger({ level: "debug", write: (entry) => entries.push(entry) }),
    requestId: "r-test",
  } as unknown as AppLoadContext;
}

beforeEach(() => {
  captureError.mockClear();
});

describe("handleError", () => {
  // A loader throwing data(null, { status: 404 }) — the unmatched-URL case now
  // renders `routes/not-found.tsx` from a successful loader and never gets here.
  it("logs a thrown 404 at warn and never captures it", () => {
    const entries: LogEntry[] = [];

    handleError(routeErrorResponse(404), {
      request: new Request("http://localhost/dashboard/items/missing"),
      context: makeContext(entries),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      msg: "loader.rejected",
      status: 404,
      path: "/dashboard/items/missing",
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it("skips capture for any 4xx route error response", () => {
    const entries: LogEntry[] = [];

    handleError(routeErrorResponse(405, "Method Not Allowed"), {
      request: new Request("http://localhost/api-ish"),
      context: makeContext(entries),
    });

    expect(entries[0]).toMatchObject({ level: "warn", status: 405 });
    expect(captureError).not.toHaveBeenCalled();
  });

  it("still captures a 5xx route error response — that one is a real failure", () => {
    const entries: LogEntry[] = [];

    handleError(routeErrorResponse(500, "boom"), {
      request: new Request("http://localhost/broken"),
      context: makeContext(entries),
    });

    expect(entries[0]).toMatchObject({ level: "error", msg: "loader.failed" });
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("captures a thrown Error with the request id and path", () => {
    const entries: LogEntry[] = [];
    const error = new Error("loader exploded");

    handleError(error, {
      request: new Request("http://localhost/dashboard/settings.data?secret=nope"),
      context: makeContext(entries),
    });

    expect(entries[0]).toMatchObject({ level: "error", msg: "loader.failed" });
    // Path only — never the full URL, whose query string is attacker-controlled.
    expect(captureError).toHaveBeenCalledWith(error, {
      requestId: "r-test",
      path: "/dashboard/settings.data",
    });
  });

  it("does nothing when the client already went away", () => {
    const entries: LogEntry[] = [];
    const controller = new AbortController();
    controller.abort();

    handleError(new Error("aborted mid-flight"), {
      request: new Request("http://localhost/slow", { signal: controller.signal }),
      context: makeContext(entries),
    });

    expect(entries).toHaveLength(0);
    expect(captureError).not.toHaveBeenCalled();
  });
});
