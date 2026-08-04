import { redact } from "./redact";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogFields {
  readonly [key: string]: unknown;
}

/** A single structured record. `level`/`msg`/`time` always win over user fields. */
export interface LogEntry extends LogFields {
  readonly level: LogLevel;
  readonly msg: string;
  readonly time: string;
}

export type LogWriter = (entry: LogEntry) => void;

export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Derive a logger that stamps `fields` onto every entry. */
  child(fields: LogFields): Logger;
}

export interface CreateLoggerOptions {
  /** Entries below this level are dropped. Default `info`. */
  level?: LogLevel;
  /** Fields stamped onto every entry (request id, version, ...). */
  base?: LogFields;
  /** Where entries go. Default `consoleWriter`. */
  write?: LogWriter;
  /** Clock seam for tests. Default `() => new Date().toISOString()`. */
  now?: () => string;
}

/**
 * Default sink. Passes the entry **object** (not a JSON string) to `console`,
 * because Cloudflare Workers Logs indexes object properties as queryable
 * fields while a pre-stringified line arrives as one opaque message.
 */
export const consoleWriter: LogWriter = (entry) => {
  switch (entry.level) {
    case "error":
      console.error(entry);
      break;
    case "warn":
      console.warn(entry);
      break;
    case "debug":
      console.debug(entry);
      break;
    default:
      console.info(entry);
  }
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const write = options.write ?? consoleWriter;
  const now = options.now ?? (() => new Date().toISOString());
  const threshold = LEVEL_RANK[level];

  const log = (entryLevel: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_RANK[entryLevel] < threshold) return;

    // Everything — including redact() — is inside the try. redact walks
    // property getters, so a logged object with a throwing getter would
    // otherwise escape this function. That is worst inside an error handler:
    // logging { error } for such an error would make the handler itself throw
    // and lose the original failure.
    try {
      const merged = fields ? { ...base, ...fields } : base;
      write({
        ...(redact(merged) as LogFields),
        level: entryLevel,
        msg,
        time: now(),
      });
    } catch {
      // Logging must never take down the request it is describing.
    }
  };

  return {
    level,
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, write, now }),
  };
}

/**
 * Pick the log level from Worker bindings: explicit `LOG_LEVEL` wins, otherwise
 * development is chatty (`debug`) and everything else is not (`info`).
 */
export function resolveLogLevel(env: {
  LOG_LEVEL?: string | undefined;
  ENVIRONMENT?: string | undefined;
}): LogLevel {
  if (isLogLevel(env.LOG_LEVEL)) return env.LOG_LEVEL;
  return env.ENVIRONMENT === "development" ? "debug" : "info";
}
