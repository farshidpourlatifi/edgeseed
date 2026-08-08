# @starter/email

## Why this exists

Transactional email for the auth flows — verification and password reset.
Cloudflare cannot do this: Email Routing is inbound only, and the Email Workers
`send_email` binding rejects any recipient outside
`allowed_destination_addresses`. So a third party is required, and this package
is the seam that keeps it swappable (`docs/adr/003-transactional-email.md`).

## Layout

- `src/sender.ts` — the `EmailSender` port (one method), `EmailMessage`, `EmailSendError`, and the narrow `EmailLogger` shape
- `src/resend.ts` — Resend transport: one `fetch` to `api.resend.com/emails`, no SDK
- `src/logger-sender.ts` — the no-credentials fallback
- `src/create.ts` — `createEmailSender()` picks a transport from env
- `src/templates.ts` — verification and reset bodies, plus `escapeHtml`

## Rules

- **Consumers depend on `EmailSender`, never on `createResendSender`.** A new
  provider is a new file implementing the port; no caller changes.
- **The fallback logs a body only in development.** Anywhere else a verification
  URL is a live single-use credential and the recipient is PII, so both are
  dropped and the entry is a `warn` — the absence of a provider outside dev is a
  misconfiguration, not a mode. Mirrors how `sentryOptions()` degrades.
- **`apiKey` and `from` are required together.** A key with no verified sender
  fails at Resend on every send — worse than falling back, because it surfaces
  as a 4xx per signup rather than one warning.
- **Escape URLs in HTML.** Better Auth links carry `&callbackURL=`; a bare `&`
  in an `href` is invalid and some clients truncate the link there.
- Never put the API key in an error — `EmailSendError` carries status + body only.

## Testing

- Tests in `src/__tests__/`, `fetch` injected via `fetchImpl`
- **Coverage target: 100%** — small, pure, no I/O of its own
- Transport selection is asserted on behaviour (an HTTP call vs a log line), not
  on which factory was called
