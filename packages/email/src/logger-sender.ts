import type { EmailLogger, EmailMessage, EmailSender } from "./sender";

export interface LoggerSenderOptions {
  logger: EmailLogger;
  /**
   * Include the rendered text body in the log entry.
   *
   * True only in development, where reading the verification link out of the
   * `pnpm dev` output IS the delivery mechanism. Anywhere else this would put a
   * live single-use credential into Workers Logs, so the body — and the
   * recipient, which is PII — are dropped.
   */
  includeBody: boolean;
}

/**
 * The no-provider fallback, mirroring how `sentryOptions()` degrades to a
 * pass-through without a DSN: a fresh clone runs, signs up, and verifies with
 * no Resend account.
 *
 * Outside development this is a misconfiguration, not a mode — hence `warn`.
 */
export function createLoggerSender(options: LoggerSenderOptions): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      if (options.includeBody) {
        options.logger.info("email.send.logged", {
          to: message.to,
          subject: message.subject,
          body: message.text,
        });
        return;
      }

      options.logger.warn("email.send.dropped", {
        subject: message.subject,
        reason: "RESEND_API_KEY or EMAIL_FROM is not set",
      });
    },
  };
}
