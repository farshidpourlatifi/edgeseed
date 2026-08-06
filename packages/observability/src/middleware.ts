import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { APP_VERSION } from "@starter/config/version";
import { consoleWriter, createLogger, resolveLogLevel, type Logger } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";
import {
  bindSentryRequestScope,
  captureError,
  withSentryBreadcrumbs,
  withSentryLogs,
  type SentryEnv,
} from "./sentry";

export interface ObservabilityEnv {
  Bindings: SentryEnv & {
    ENVIRONMENT?: string;
    LOG_LEVEL?: string;
  };
  Variables: {
    logger: Logger;
    requestId: string;
  };
}

/**
 * Per-request logger + correlation id, and the matching Sentry scope tags.
 *
 * Mount this first, before anything that can fail, so every later error is
 * logged with a request id that also appears on the Sentry event and in the
 * `x-request-id` response header.
 *
 * Pair it with `app.onError(observabilityErrorHandler)` — this middleware
 * records the request outcome, that handler records *why* it failed.
 */
export const observabilityMiddleware = createMiddleware<ObservabilityEnv>(async (c, next) => {
  const requestId = resolveRequestId(c.req.raw.headers);
  const method = c.req.method;
  const path = c.req.path;

  const logger = createLogger({
    level: resolveLogLevel(c.env ?? {}),
    base: {
      requestId,
      env: c.env?.ENVIRONMENT ?? "development",
      version: APP_VERSION,
    },
    // Each entry lands in three places: Cloudflare Workers Logs (console),
    // Sentry Logs (queryable stream), and the breadcrumb trail of any error
    // event from this request.
    write: withSentryLogs(withSentryBreadcrumbs(consoleWriter)),
  }).child({ method, path });

  c.set("requestId", requestId);
  c.set("logger", logger);
  bindSentryRequestScope({ requestId, method, path });

  const start = Date.now();
  logger.debug("request.start");

  // No try/catch here on purpose: Hono's compose() resolves every throw through
  // the app's error handler before it unwinds to this middleware, so a `catch`
  // would be unreachable. Error *detail* comes from `observabilityErrorHandler`
  // below; this middleware only records the outcome.
  await next();

  const durationMs = Date.now() - start;
  const status = c.res.status;
  const fields = { status, durationMs };

  if (status >= 500) logger.error("request.complete", fields);
  else if (status >= 400) logger.warn("request.complete", fields);
  else logger.info("request.complete", fields);

  setRequestIdHeader(c.res, requestId);
});

/**
 * Hono `onError` handler: report the failure, then answer with a body that
 * carries the correlation id so a user can quote it in a bug report.
 *
 * This — not the middleware — is where handler errors surface, because Hono's
 * compose() resolves every throw through the app's error handler before it
 * unwinds back through the middleware stack.
 *
 * Expected 4xx rejections are logged at `warn` and never reach Sentry; only
 * genuine 5xx failures are captured.
 *
 * Generic over the app's own Env because Hono's `Context` is invariant in it —
 * a handler pinned to `ObservabilityEnv` will not accept a `Hono<ServerEnv>`.
 */
export function observabilityErrorHandler<E extends ObservabilityEnv>(
  err: Error,
  c: Context<E>,
): Response {
  const requestId: string | undefined = c.get("requestId");
  const logger: Logger | undefined = c.get("logger");
  const status = err instanceof HTTPException ? err.status : 500;

  if (status >= 500) {
    logger?.error("request.failed", { status, error: err });
    captureError(err, { requestId });
  } else {
    logger?.warn("request.rejected", { status, error: err });
  }

  if (err instanceof HTTPException) {
    const response = err.getResponse();
    if (requestId) setRequestIdHeader(response, requestId);
    return response;
  }

  return c.json({ error: "Internal Server Error", requestId }, 500);
}

/**
 * Echo the correlation id so a user can quote it in a bug report.
 * Best-effort: some responses (redirects, `fetch` results) have immutable headers.
 */
export function setRequestIdHeader(response: Response, requestId: string): void {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // Immutable headers — not worth failing a served response over.
  }
}
