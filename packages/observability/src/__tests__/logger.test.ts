import { describe, it, expect, vi } from "vitest";
import { createLogger, isLogLevel, resolveLogLevel, type LogEntry } from "../logger";
import { REDACTED } from "../redact";

function collect() {
  const entries: LogEntry[] = [];
  return { entries, write: (entry: LogEntry) => entries.push(entry) };
}

const now = () => "2026-08-04T00:00:00.000Z";

describe("isLogLevel", () => {
  it("accepts the four levels and rejects anything else", () => {
    expect(isLogLevel("debug")).toBe(true);
    expect(isLogLevel("error")).toBe(true);
    expect(isLogLevel("trace")).toBe(false);
    expect(isLogLevel(undefined)).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});

describe("resolveLogLevel", () => {
  it("honours an explicit LOG_LEVEL", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "warn", ENVIRONMENT: "production" })).toBe("warn");
  });

  it("is chatty in development and quiet elsewhere", () => {
    expect(resolveLogLevel({ ENVIRONMENT: "development" })).toBe("debug");
    expect(resolveLogLevel({ ENVIRONMENT: "production" })).toBe("info");
    expect(resolveLogLevel({})).toBe("info");
  });

  it("ignores a malformed LOG_LEVEL", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "loud", ENVIRONMENT: "production" })).toBe("info");
  });
});

describe("createLogger", () => {
  it("emits level, msg and time on every entry", () => {
    const { entries, write } = collect();
    createLogger({ write, now }).info("hello");

    expect(entries).toEqual([{ level: "info", msg: "hello", time: now() }]);
  });

  it("drops entries below the configured level", () => {
    const { entries, write } = collect();
    const logger = createLogger({ level: "warn", write, now });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("merges base fields with per-call fields", () => {
    const { entries, write } = collect();
    createLogger({ base: { requestId: "r1" }, write, now }).info("hi", { status: 200 });

    expect(entries[0]).toMatchObject({ requestId: "r1", status: 200 });
  });

  it("lets per-call fields override base fields", () => {
    const { entries, write } = collect();
    createLogger({ base: { scope: "base" }, write, now }).info("hi", { scope: "call" });

    expect(entries[0].scope).toBe("call");
  });

  it("does not let fields overwrite level, msg or time", () => {
    const { entries, write } = collect();
    createLogger({ write, now }).info("real", {
      level: "debug",
      msg: "spoofed",
      time: "1999",
    });

    expect(entries[0]).toMatchObject({ level: "info", msg: "real", time: now() });
  });

  it("redacts sensitive fields", () => {
    const { entries, write } = collect();
    createLogger({ write, now }).info("login", { email: "a@b.c", password: "hunter2" });

    expect(entries[0]).toMatchObject({ email: "a@b.c", password: REDACTED });
  });

  it("serializes Error fields", () => {
    const { entries, write } = collect();
    createLogger({ write, now }).error("failed", { error: new Error("boom") });

    expect(entries[0].error).toMatchObject({ name: "Error", message: "boom" });
  });

  describe("child", () => {
    it("inherits base fields and adds its own", () => {
      const { entries, write } = collect();
      const child = createLogger({ base: { a: 1 }, write, now }).child({ b: 2 });
      child.info("hi");

      expect(entries[0]).toMatchObject({ a: 1, b: 2 });
    });

    it("inherits the level", () => {
      const { entries, write } = collect();
      createLogger({ level: "error", write, now }).child({ a: 1 }).warn("ignored");

      expect(entries).toHaveLength(0);
    });

    it("leaves the parent untouched", () => {
      const { entries, write } = collect();
      const parent = createLogger({ write, now });
      parent.child({ child: true });
      parent.info("hi");

      expect(entries[0].child).toBeUndefined();
    });
  });

  it("swallows sink failures so logging cannot break a request", () => {
    const logger = createLogger({
      write: () => {
        throw new Error("sink down");
      },
      now,
    });

    expect(() => logger.info("hi")).not.toThrow();
  });

  it("routes each level to the matching console method by default", () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    const logger = createLogger({ level: "debug", now });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(spies.debug).toHaveBeenCalledWith({ level: "debug", msg: "d", time: now() });
    expect(spies.info).toHaveBeenCalledOnce();
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(spies.error).toHaveBeenCalledOnce();

    for (const spy of Object.values(spies)) spy.mockRestore();
  });
});
