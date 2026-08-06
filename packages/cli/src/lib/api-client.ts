/**
 * Pure request-building for `pnpm api:call`.
 *
 * Kept separate from the script body so the parsing and auth-header rules are
 * testable without a network or a live Worker.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const DEFAULT_API_URL = "http://localhost:5173";

export interface ApiArgs {
  method: HttpMethod;
  path: string;
  body?: string;
}

export class ApiUsageError extends Error {}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

/** Parse `["GET", "/me"]` or `["POST", "/tokens", "{...}"]`. */
export function parseApiArgs(argv: readonly string[]): ApiArgs {
  const [rawMethod, path, body] = argv;

  if (!rawMethod || !path) {
    throw new ApiUsageError(`Usage: pnpm api:call <${HTTP_METHODS.join("|")}> <path> [json-body]`);
  }

  const method = rawMethod.toUpperCase();
  if (!isHttpMethod(method)) {
    throw new ApiUsageError(
      `Unsupported method "${rawMethod}". Use one of: ${HTTP_METHODS.join(", ")}`,
    );
  }

  if (!path.startsWith("/")) {
    throw new ApiUsageError(`Path must start with "/" — got "${path}"`);
  }

  if (body !== undefined) {
    try {
      JSON.parse(body);
    } catch {
      throw new ApiUsageError("Body must be valid JSON");
    }
  }

  return body === undefined ? { method, path } : { method, path, body };
}

export interface BuildRequestInput extends ApiArgs {
  baseUrl?: string;
  token?: string;
}

export interface BuiltRequest {
  url: string;
  init: { method: HttpMethod; headers: Record<string, string>; body?: string };
}

/**
 * Compose the outgoing request.
 *
 * Paths are resolved under `/api/v1` so callers write `/me`, not the version
 * prefix — the version is the client's business, not the user's.
 */
export function buildApiRequest(input: BuildRequestInput): BuiltRequest {
  if (!input.token) {
    // A bare `VAR=value` line sets a shell variable, not an exported one, so the
    // child process never sees it — by far the most common cause of landing here.
    throw new ApiUsageError(
      [
        "STARTER_API_TOKEN is not set.",
        "",
        "  STARTER_API_TOKEN='sk_...' pnpm api:call GET /me   # same line, or",
        "  export STARTER_API_TOKEN='sk_...'                  # once per shell",
        "",
        "Create a token in Dashboard → Settings → API tokens.",
      ].join("\n"),
    );
  }

  const base = (input.baseUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = {
    // Bearer, matching what principalMiddleware expects on /api/v1.
    Authorization: `Bearer ${input.token}`,
    Accept: "application/json",
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";

  return {
    url: `${base}/api/v1${input.path}`,
    init:
      input.body === undefined
        ? { method: input.method, headers }
        : { method: input.method, headers, body: input.body },
  };
}

/** Redact the Authorization header before anything gets printed. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const safe = { ...headers };
  if (safe.Authorization) safe.Authorization = "Bearer [redacted]";
  return safe;
}
