export const REQUEST_ID_HEADER = "x-request-id";

const MAX_LENGTH = 128;

/**
 * Inbound ids are attacker-controlled, so only a conservative token charset is
 * echoed back — anything else is replaced rather than sanitised, which keeps
 * forged separators out of log fields and downstream trace systems.
 */
const SAFE_ID = /^[A-Za-z0-9._:@/+=-]+$/;

/**
 * Correlation id for a request: reuse the caller's `x-request-id` when it is
 * well-formed, else Cloudflare's `cf-ray`, else mint one.
 */
export function resolveRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER) ?? headers.get("cf-ray");
  if (inbound) {
    const trimmed = inbound.trim().slice(0, MAX_LENGTH);
    if (SAFE_ID.test(trimmed)) return trimmed;
  }
  return crypto.randomUUID();
}
