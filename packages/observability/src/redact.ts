/**
 * Key names whose values must never reach a log sink or an error report.
 * Matched as a substring, so `sessionToken`, `X-Api-Key`, `client_secret`
 * and `SENTRY_DSN` are all caught.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|authorization|cookie|api[-_]?key|apikey|credential|private[-_]?key|dsn/i;

export const REDACTED = "[redacted]";
export const CIRCULAR = "[circular]";
export const TRUNCATED = "[truncated]";

const DEFAULT_MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;

/** Reserved Error keys handled explicitly, so the generic walk skips them. */
const ERROR_OWN_KEYS = new Set(["name", "message", "stack", "cause"]);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export interface RedactOptions {
  /** Nesting levels to keep before replacing the subtree with `[truncated]`. */
  maxDepth?: number;
}

/**
 * Produce a log-safe clone of `value`: sensitive keys blanked, Errors expanded
 * into plain objects, cycles broken, and depth/width bounded.
 *
 * Always returns fresh data — the input is never mutated.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return walk(value, 0, options.maxDepth ?? DEFAULT_MAX_DEPTH, new WeakSet<object>());
}

function walk(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      // NaN/Infinity are not representable in JSON — keep them readable instead.
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return `${value}n`;
    case "symbol":
      return value.toString();
    case "function":
      return "[function]";
  }

  const object = value as object;
  if (seen.has(object)) return CIRCULAR;
  if (depth >= maxDepth) return TRUNCATED;

  seen.add(object);
  try {
    return walkObject(object, depth, maxDepth, seen);
  } finally {
    // Release on the way out so a value referenced twice in sibling branches
    // still serializes — only genuine cycles become `[circular]`.
    seen.delete(object);
  }
}

function walkObject(
  object: object,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): unknown {
  if (object instanceof Error) return walkError(object, depth, maxDepth, seen);
  if (object instanceof Date) return object.toISOString();
  if (object instanceof RegExp) return object.toString();
  if (object instanceof Set) return walkArray([...object], depth, maxDepth, seen);
  if (object instanceof Map) {
    return walkEntries(
      [...object].map(([key, val]) => [String(key), val]),
      depth,
      maxDepth,
      seen,
    );
  }
  if (Array.isArray(object)) return walkArray(object, depth, maxDepth, seen);

  return walkEntries(Object.entries(object), depth, maxDepth, seen);
}

function walkError(
  error: Error,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  if (error.stack) out.stack = error.stack;
  if (error.cause !== undefined && error.cause !== null) {
    out.cause = walk(error.cause, depth + 1, maxDepth, seen);
  }

  // Custom fields on Error subclasses (status codes, request ids, ...) are
  // often the most useful part of the report — keep them, redacted.
  for (const [key, val] of Object.entries(error)) {
    if (ERROR_OWN_KEYS.has(key)) continue;
    out[key] = isSensitiveKey(key) ? REDACTED : walk(val, depth + 1, maxDepth, seen);
  }
  return out;
}

function walkArray(
  items: readonly unknown[],
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): unknown[] {
  const kept: unknown[] = items
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => walk(item, depth + 1, maxDepth, seen));
  if (items.length > MAX_ARRAY_ITEMS) {
    kept.push(`[+${items.length - MAX_ARRAY_ITEMS} more]`);
  }
  return kept;
}

function walkEntries(
  entries: readonly (readonly [string, unknown])[],
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of entries) {
    out[key] = isSensitiveKey(key) ? REDACTED : walk(val, depth + 1, maxDepth, seen);
  }
  return out;
}
