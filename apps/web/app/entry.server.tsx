import type { AppLoadContext, EntryContext } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
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

/**
 * Report the path, never the full URL.
 *
 * `request.url` carries an attacker-controlled query string, and `redact()`
 * matches on field *names* only — so a `?token=` or `?code=` would reach Workers
 * Logs and Sentry verbatim. The path is what identifies the failing route; the
 * correlation id is how you get back to the rest.
 */
function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "(unparseable url)";
  }
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

  // One nonce for every inline script React Router emits. Passing it to
  // `ServerRouter` covers the nonce-aware components (`<Scripts>`,
  // `<ScrollRestoration>`, `<Links>`, `<Meta>`) *and* the stream-transfer
  // chunks that push loader data — those last two are emitted mid-stream, so
  // they cannot be nonced from root.tsx and were the ones CSP blocked first.
  // The option on `renderToReadableStream` covers React's own bootstrap
  // scripts, which are separate again.
  const cspNonce: string | undefined = loadContext?.cspNonce;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={cspNonce} />,
    {
      nonce: cspNonce,
      signal: request.signal,
      onError(error: unknown) {
        const path = safePath(request);
        loggerFor(loadContext).error("ssr.render_failed", { error, path });
        captureError(error, { requestId, path });
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

  const path = safePath(request);

  // Expected 4xx — a loader or action throwing data() with a 4xx, or the
  // router's own 405 for a POST at a route that declares no action. Same
  // contract as observabilityErrorHandler: logged at warn, never sent to
  // Sentry. A 5xx ErrorResponse falls through — that one is a genuine failure.
  //
  // Unmatched URLs no longer arrive here: `routes/not-found.tsx` is a splat
  // that renders the branded 404 from a *successful* loader, so every crawler
  // probing /wp-admin is a normal render rather than a route error.
  if (isRouteErrorResponse(error) && error.status < 500) {
    loggerFor(context).warn("loader.rejected", { status: error.status, error, path });
    return;
  }

  loggerFor(context).error("loader.failed", { error, path });
  captureError(error, { requestId: context?.requestId, path });
}
