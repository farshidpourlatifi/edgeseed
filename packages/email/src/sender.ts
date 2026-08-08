/**
 * The transport port and its two implementations' shared types.
 *
 * `EmailSender` is deliberately one method wide. Swapping Resend for SES is a
 * new file implementing this interface, never an edit to a caller — and a fake
 * in a test is three lines.
 */

/** A rendered email, ready for a transport. Templates produce the body; the caller supplies `to`. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** A message body before a recipient is attached — what `templates.ts` returns. */
export type EmailBody = Omit<EmailMessage, "to">;

/** The only capability the auth layer needs from an email provider. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * The narrowest logger shape this package uses. Structurally satisfied by
 * `Logger` from `@starter/observability`, without taking a dependency on it
 * for one type.
 */
export interface EmailLogger {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

/** Thrown when a provider rejects a send. Carries the status; never the API key. */
export class EmailSendError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Email provider rejected the send (HTTP ${status})`);
    this.name = "EmailSendError";
  }
}
