import { describe, it, expect, vi } from "vitest";
import { APP_VERSION } from "@starter/config/version";
import {
  bindSentryRequestScope,
  captureError,
  identifySentryUser,
  parseSampleRate,
  sentryOptions,
  sentryOptionsOrDisabled,
  withoutConsoleIntegration,
  withSentryBreadcrumbs,
} from "../sentry";
import type { LogEntry } from "../logger";

const DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

describe("parseSampleRate", () => {
  it("parses a numeric string", () => {
    expect(parseSampleRate("0.25")).toBe(0.25);
  });

  it("accepts a number as-is", () => {
    expect(parseSampleRate(1)).toBe(1);
  });

  it.each([undefined, "", "abc", "-0.1", "1.5", Number.NaN])("falls back for %s", (value) => {
    expect(parseSampleRate(value as string | number | undefined)).toBe(0);
  });

  it("honours a custom fallback", () => {
    expect(parseSampleRate(undefined, 0.1)).toBe(0.1);
  });

  it("keeps the inclusive bounds", () => {
    expect(parseSampleRate("0")).toBe(0);
    expect(parseSampleRate("1")).toBe(1);
  });
});

describe("sentryOptions", () => {
  it("returns undefined without a DSN, so withSentry stays a pass-through", () => {
    expect(sentryOptions({})).toBeUndefined();
    expect(sentryOptions({ SENTRY_DSN: "" })).toBeUndefined();
    expect(sentryOptions({ SENTRY_DSN: "   " })).toBeUndefined();
  });

  it("builds options from the DSN and environment", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN, ENVIRONMENT: "production" })).toEqual({
      dsn: DSN,
      environment: "production",
      release: APP_VERSION,
      tracesSampleRate: 0,
      enableLogs: true,
      integrations: withoutConsoleIntegration,
      sendDefaultPii: false,
    });
  });

  it("enables Sentry Logs, so the structured stream is queryable there too", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })).toMatchObject({ enableLogs: true });
  });

  it("lets SENTRY_ENVIRONMENT and SENTRY_RELEASE override the defaults", () => {
    const options = sentryOptions({
      SENTRY_DSN: DSN,
      ENVIRONMENT: "production",
      SENTRY_ENVIRONMENT: "canary",
      SENTRY_RELEASE: "web@9.9.9",
    });

    expect(options).toMatchObject({ environment: "canary", release: "web@9.9.9" });
  });

  it("reads the trace sample rate from the binding", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: "0.2" })).toMatchObject({
      tracesSampleRate: 0.2,
    });
  });

  it("never opts into PII by default", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })).toMatchObject({ sendDefaultPii: false });
  });

  it("defaults the environment to development", () => {
    expect(sentryOptions({ SENTRY_DSN: DSN })).toMatchObject({ environment: "development" });
  });
});

describe("sentryOptionsOrDisabled", () => {
  it("returns the same options as sentryOptions when a DSN is set", () => {
    expect(sentryOptionsOrDisabled({ SENTRY_DSN: DSN })).toEqual(
      sentryOptions({ SENTRY_DSN: DSN }),
    );
  });

  // Agent/DO instrumentation cannot accept `undefined`, so a missing DSN has to
  // produce a disabled client rather than an uninstrumented class.
  it("returns an empty (disabled) options object with no DSN", () => {
    expect(sentryOptionsOrDisabled({})).toEqual({});
  });
});

// These wrap Sentry's global API, which no-ops without an initialised client.
// The contract that matters for a starter is that they never throw when Sentry
// is switched off — otherwise disabling Sentry would break the request path.
describe("capture helpers with Sentry disabled", () => {
  it("captureError does not throw", () => {
    expect(() => captureError(new Error("boom"))).not.toThrow();
    expect(() => captureError(new Error("boom"), { requestId: "r1" })).not.toThrow();
  });

  it("identifySentryUser does not throw, with or without a user", () => {
    expect(() => identifySentryUser({ id: "u1" })).not.toThrow();
    expect(() => identifySentryUser({ id: "u1", organizationId: "o1" })).not.toThrow();
    expect(() => identifySentryUser(null)).not.toThrow();
  });

  it("bindSentryRequestScope does not throw", () => {
    expect(() =>
      bindSentryRequestScope({ requestId: "r1", method: "GET", path: "/x" }),
    ).not.toThrow();
  });
});

describe("withoutConsoleIntegration", () => {
  it("drops the Console integration", () => {
    const kept = withoutConsoleIntegration([
      { name: "Console" },
      { name: "Fetch" },
      { name: "LinkedErrors" },
    ]);

    expect(kept.map((i) => i.name)).toEqual(["Fetch", "LinkedErrors"]);
  });

  it("keeps every other integration, including when Console is absent", () => {
    const defaults = [{ name: "Fetch" }, { name: "Dedupe" }];
    expect(withoutConsoleIntegration(defaults)).toEqual(defaults);
  });

  it("matches on the exact name, not a prefix", () => {
    // A future `ConsoleLogging` integration must survive this filter.
    expect(withoutConsoleIntegration([{ name: "ConsoleLogging" }])).toEqual([
      { name: "ConsoleLogging" },
    ]);
  });
});

describe("withSentryBreadcrumbs", () => {
  const entry: LogEntry = {
    level: "warn",
    msg: "slow.query",
    time: "2026-08-04T00:00:00.000Z",
    durationMs: 1200,
  };

  it("still writes through to the wrapped sink", () => {
    const write = vi.fn();
    withSentryBreadcrumbs(write)(entry);
    expect(write).toHaveBeenCalledWith(entry);
  });

  it("is a no-op when Sentry is not initialised", () => {
    expect(() => withSentryBreadcrumbs(() => {})(entry)).not.toThrow();
  });
});
