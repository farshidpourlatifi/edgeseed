import { EmailSendError, type EmailMessage, type EmailSender } from "./sender";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Cap on the error body we surface, so a provider HTML error page cannot flood a log entry. */
const MAX_DETAIL_LENGTH = 500;

export interface ResendSenderOptions {
  /** Resend API key (`re_...`). */
  apiKey: string;
  /** Verified sender, plain or `"Name <addr@domain>"`. The domain must be verified in Resend. */
  from: string;
  /** Seam for tests. Defaults to the global `fetch`, which Workers provide. */
  fetchImpl?: typeof fetch;
}

/**
 * Resend transport — a single `fetch`, no SDK.
 *
 * Chosen because Cloudflare has no first-party way to send to an arbitrary
 * recipient: Email Routing is inbound only, and the Email Workers `send_email`
 * binding rejects any address outside `allowed_destination_addresses`
 * (`E_RECIPIENT_NOT_ALLOWED`). See docs/adr/003-transactional-email.md.
 */
export function createResendSender(options: ResendSenderOptions): EmailSender {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!response.ok) {
        throw new EmailSendError(response.status, await readDetail(response));
      }
    },
  };
}

/** A failed send must not become a second failure — never let body parsing throw. */
async function readDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, MAX_DETAIL_LENGTH);
  } catch {
    return "<unreadable response body>";
  }
}
