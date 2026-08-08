import { createLoggerSender } from "./logger-sender";
import { createResendSender } from "./resend";
import type { EmailLogger, EmailSender } from "./sender";

export interface CreateEmailSenderOptions {
  /** `RESEND_API_KEY`. Absent ⇒ the logger fallback. */
  apiKey?: string;
  /** `EMAIL_FROM`. Absent ⇒ the logger fallback: Resend rejects a send with no verified sender. */
  from?: string;
  /** Request-scoped logger, so a dropped email carries the request's correlation id. */
  logger: EmailLogger;
  /** `ENVIRONMENT`. Only `"development"` may log a message body. */
  environment?: string;
  /** Seam for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Pick a transport from the environment.
 *
 * Both credentials are required together: a key with no verified sender fails
 * at Resend on every send, which is a worse failure than falling back, because
 * it surfaces as a 4xx per signup instead of one warning.
 */
export function createEmailSender(options: CreateEmailSenderOptions): EmailSender {
  if (options.apiKey && options.from) {
    return createResendSender({
      apiKey: options.apiKey,
      from: options.from,
      fetchImpl: options.fetchImpl,
    });
  }

  return createLoggerSender({
    logger: options.logger,
    includeBody: options.environment === "development",
  });
}
