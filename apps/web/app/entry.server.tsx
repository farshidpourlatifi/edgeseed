import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { captureError } from "@starter/observability/sentry";
import { createLogger, REQUEST_ID_HEADER, type Logger } from "@starter/observability";

/**
 * `observabilityMiddleware` populates `logger`/`requestId` on the load context,
 * but React Router reaches these entry points through paths that bypass the Hono
 * app — notably the Vite dev server, which serves some documents through
 * `@react-router/dev`'s own node handler.
 *
 * An error reporter that throws masks the very error it was called about, so
 * never assume the context is populated.
 */
const fallbackLogger = createLogger();

function loggerFor(context: AppLoadContext | undefined): Logger {
  return context?.logger ?? fallbackLogger;
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
) {
  const userAgent = request.headers.get("user-agent");
  const requestId: string | undefined = loadContext?.requestId;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error: unknown) {
        loggerFor(loadContext).error("ssr.render_failed", { error, url: request.url });
        captureError(error, { requestId, url: request.url });
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(userAgent)) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  // Surface the correlation id on HTML responses too, so a user reporting a
  // broken page can quote the same id that appears in the logs.
  if (requestId) responseHeaders.set(REQUEST_ID_HEADER, requestId);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/**
 * React Router's hook for every server-side loader/action error.
 * Sentry's dedupe integration collapses anything also seen by `onError` above.
 */
export function handleError(
  error: unknown,
  { request, context }: { request: Request; context: AppLoadContext },
) {
  // The client went away mid-flight — nothing is broken, don't page anyone.
  if (request.signal.aborted) return;

  loggerFor(context).error("loader.failed", { error, url: request.url });
  captureError(error, { requestId: context?.requestId, url: request.url });
}
