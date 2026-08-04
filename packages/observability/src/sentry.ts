import {
  addBreadcrumb,
  captureException,
  setContext,
  setTag,
  setUser,
  type CloudflareOptions,
} from "@sentry/cloudflare";
import { APP_VERSION } from "@starter/config/version";
import type { LogEntry, LogLevel, LogWriter } from "./logger";

/** The subset of Worker bindings Sentry reads. All optional — Sentry is opt-in. */
export interface SentryEnv {
  SENTRY_DSN?: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE?: string | number | undefined;
  SENTRY_ENVIRONMENT?: string | undefined;
  SENTRY_RELEASE?: string | undefined;
  ENVIRONMENT?: string | undefined;
}

/** Clamp a `0..1` sample rate coming from a string binding. */
export function parseSampleRate(value: string | number | undefined, fallback = 0): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

/**
 * Build the options `withSentry()` initialises from.
 *
 * Returns `undefined` when no DSN is set, which makes `withSentry()` a
 * pass-through — so a fresh clone, local dev, and CI all run with no Sentry
 * account and no code changes.
 */
export function sentryOptions(env: SentryEnv): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return undefined;

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.ENVIRONMENT ?? "development",
    release: env.SENTRY_RELEASE ?? APP_VERSION,
    tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    // Never ship IPs, headers or bodies by default — opt in per product after
    // a privacy review, not as a starter default.
    sendDefaultPii: false,
  };
}

/**
 * Same as {@link sentryOptions}, but always returns an object.
 *
 * Durable Object / Agent instrumentation requires a callback that cannot return
 * `undefined`, so a missing DSN yields a *disabled* client instead of an
 * uninstrumented class. This matters for `apps/mcp`: the Agent runs in its own
 * context, and `withSentry` on the outer fetch handler does not initialise
 * Sentry inside it.
 */
export function sentryOptionsOrDisabled(env: SentryEnv): CloudflareOptions {
  return sentryOptions(env) ?? {};
}

const SENTRY_LEVEL: Record<LogLevel, "debug" | "info" | "warning" | "error"> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

/**
 * Wrap a writer so every log entry also lands as a Sentry breadcrumb; an error
 * report then carries the request's log trail instead of a bare stack.
 *
 * No-ops when Sentry is not initialised.
 */
export function withSentryBreadcrumbs(write: LogWriter): LogWriter {
  return (entry: LogEntry) => {
    write(entry);
    const { level, msg, time: _time, ...data } = entry;
    addBreadcrumb({ category: "log", level: SENTRY_LEVEL[level], message: msg, data });
  };
}

/** Tag the active Sentry scope so events join up with the log lines. */
export function bindSentryRequestScope(fields: {
  requestId: string;
  method: string;
  path: string;
}): void {
  setTag("request_id", fields.requestId);
  setContext("request_meta", { ...fields });
}

/** Attach the authenticated principal to the active Sentry scope. */
export function identifySentryUser(user: { id: string; organizationId?: string } | null): void {
  setUser(user ? { id: user.id } : null);
  if (user?.organizationId) setTag("organization_id", user.organizationId);
}

/** Report an error to Sentry. Safe to call when Sentry is not configured. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  captureException(error, context ? { extra: context } : undefined);
}
