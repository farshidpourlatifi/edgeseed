/**
 * What the reset screen was handed.
 *
 * `/reset-password` is never opened directly — the reader arrives by 302 from
 * `GET /api/auth/reset-password/:token`, which appends **either** `?token=…`
 * **or** `?error=INVALID_TOKEN` (better-auth `api/routes/password.mjs`:
 * `redirectCallback` / `redirectError`). Both land on the same URL, so the
 * screen has two entry states and rendering a password form in the wrong one
 * is a dead end: the reader fills it in and the POST is refused.
 *
 * Pure and separate from the route so the branching is unit-testable and
 * mutation-tested — a component test would prove far less for far more setup.
 */
export type ResetLinkState =
  /** A token to submit alongside the new password. Not validated here: only the server can. */
  | { kind: "ready"; token: string }
  /** No usable token. The screen offers a fresh request rather than a form. */
  | { kind: "invalid" };

const INVALID: ResetLinkState = { kind: "invalid" };

/**
 * Read the reset screen's entry state out of its query string.
 *
 * `error` is checked **before** `token` on purpose. The two are not expected
 * together, but if they ever arrive that way the only safe reading is the
 * refusal — treating a token as usable because it happened to sit next to an
 * error is the failing-open direction, and better-auth would reject it anyway
 * one round trip later.
 *
 * A blank or whitespace-only `token` is the same as an absent one. `?token=`
 * with nothing after it is what a truncated or mangled link produces, and
 * `URLSearchParams` reports that as `""` rather than `null`, so the presence
 * check alone would let it through to a POST that answers `INVALID_TOKEN`.
 */
export function resetLinkState(params: URLSearchParams): ResetLinkState {
  if (params.get("error")) return INVALID;

  const token = params.get("token")?.trim();
  return token ? { kind: "ready", token } : INVALID;
}
