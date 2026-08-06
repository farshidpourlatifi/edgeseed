export { consoleWriter, createLogger, isLogLevel, LOG_LEVELS, resolveLogLevel } from "./logger";
export type {
  CreateLoggerOptions,
  LogEntry,
  LogFields,
  Logger,
  LogLevel,
  LogWriter,
} from "./logger";

export { isSensitiveKey, redact, REDACTED } from "./redact";
export type { RedactOptions } from "./redact";

export { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export {
  bindSentryRequestScope,
  captureError,
  identifySentryUser,
  parseSampleRate,
  sentryOptions,
  sentryOptionsOrDisabled,
  withSentryBreadcrumbs,
} from "./sentry";
export type { SentryEnv } from "./sentry";

// NOTE: the Hono middleware is deliberately NOT re-exported here. It imports
// `hono/factory`, and this barrel must stay importable from Workers that do not
// depend on Hono (apps/mcp). Import it from "@starter/observability/middleware".
