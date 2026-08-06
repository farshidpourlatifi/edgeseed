/**
 * Separate file because these assert what reaches Sentry, which needs the SDK
 * mocked. `sentry.test.ts` deliberately runs against the *real* module with no
 * client initialised, proving the helpers no-op rather than throw when Sentry
 * is switched off — mocking there would delete that guarantee.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sentryLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

vi.mock("@sentry/cloudflare", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  logger: sentryLogger,
  setContext: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}));

const { withSentryLogs } = await import("../sentry");
const { createLogger } = await import("../logger");
import type { LogEntry } from "../logger";

const entry: LogEntry = {
  level: "warn",
  msg: "slow.query",
  time: "2026-08-04T00:00:00.000Z",
  requestId: "r1",
  durationMs: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withSentryLogs", () => {
  it("still writes through to the wrapped sink", () => {
    const write = vi.fn();
    withSentryLogs(write)(entry);
    expect(write).toHaveBeenCalledWith(entry);
  });

  it("sends the message and the remaining fields as attributes", () => {
    withSentryLogs(() => {})(entry);

    expect(sentryLogger.warn).toHaveBeenCalledWith("slow.query", {
      requestId: "r1",
      durationMs: 1200,
    });
  });

  it("strips level, msg and time from the attributes — Sentry owns those", () => {
    withSentryLogs(() => {})(entry);

    const [, attributes] = sentryLogger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(attributes).not.toHaveProperty("level");
    expect(attributes).not.toHaveProperty("msg");
    expect(attributes).not.toHaveProperty("time");
  });

  it.each(["debug", "info", "warn", "error"] as const)("routes a %s entry to that level", (l) => {
    withSentryLogs(() => {})({ ...entry, level: l });

    expect(sentryLogger[l]).toHaveBeenCalledTimes(1);
    // The one-to-one mapping is the point: nothing should land on a sibling.
    const others = (["debug", "info", "warn", "error"] as const).filter((x) => x !== l);
    for (const other of others) expect(sentryLogger[other]).not.toHaveBeenCalled();
  });

  it("keeps a nested value intact for the SDK to normalise", () => {
    const error = { name: "Error", message: "boom" };
    withSentryLogs(() => {})({ ...entry, level: "error", error });

    expect(sentryLogger.error).toHaveBeenCalledWith(
      "slow.query",
      expect.objectContaining({ error }),
    );
  });

  it("forwards entries a real logger produces, base fields included", () => {
    createLogger({
      level: "info",
      base: { requestId: "r2", env: "production" },
      write: withSentryLogs(() => {}),
      now: () => "2026-08-04T00:00:00.000Z",
    }).info("request.complete", { status: 200 });

    expect(sentryLogger.info).toHaveBeenCalledWith("request.complete", {
      requestId: "r2",
      env: "production",
      status: 200,
    });
  });

  it("does not forward an entry the level threshold drops", () => {
    createLogger({ level: "warn", write: withSentryLogs(() => {}) }).info("ignored");

    expect(sentryLogger.info).not.toHaveBeenCalled();
  });
});
