import {
  addBreadcrumb,
  captureException,
  logger as sentryLogger,
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
    // Send the structured log stream to Sentry Logs, so it is searchable next
    // to the errors it explains rather than only in Cloudflare Workers Logs.
    // Reached only when a DSN is set, so a fresh clone still sends nothing.
    enableLogs: true,
    integrations: withoutConsoleIntegration,
    // Never ship IPs, headers or bodies by default — opt in per product after
    // a privacy review, not as a starter default.
    sendDefaultPii: false,
  };
}

/** Name of the default integration that mirrors `console.*` into breadcrumbs. */
const CONSOLE_INTEGRATION = "Console";

/**
 * Drop Sentry's default console integration.
 *
 * It records every `console.*` call as a breadcrumb, which duplicates what
 * {@link withSentryBreadcrumbs} already does properly — and duplicates it
 * badly: the writer passes the entry *object* (Workers Logs indexes object
 * properties), so the console copy stringifies to the message
 * `"[object Object]"` with the real fields buried under `data.arguments[0]`.
 *
 * Two breadcrumbs per log line also halves the useful depth of the buffer,
 * which keeps the most recent 100 — so the trail leading to an error is
 * evicted twice as fast, and half of what survives is unreadable.
 */
export function withoutConsoleIntegration<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((integration) => integration.name !== CONSOLE_INTEGRATION);
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

/**
 * Wrap a writer so every log entry is also sent to Sentry Logs — the same
 * structured record, searchable beside the errors it explains.
 *
 * Separate from {@link withSentryBreadcrumbs} on purpose: breadcrumbs are the
 * trail attached to one error event, logs are a queryable stream that exists
 * whether or not anything failed. Compose both to get each.
 *
 * Nested values (a logged `error`, say) are normalised and JSON-stringified by
 * the SDK, so they survive as attributes rather than being dropped.
 *
 * No-ops when Sentry is not initialised.
 */
export function withSentryLogs(write: LogWriter): LogWriter {
  return (entry: LogEntry) => {
    write(entry);
    const { level, msg, time: _time, ...attributes } = entry;
    // Our levels are a subset of Sentry's, so this maps one-to-one — no
    // translation table, unlike breadcrumbs where `warn` becomes `warning`.
    sentryLogger[level](msg, attributes);
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
