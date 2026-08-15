export { createEmailSender } from "./create";
export type { CreateEmailSenderOptions } from "./create";

export { createLoggerSender } from "./logger-sender";
export type { LoggerSenderOptions } from "./logger-sender";

export { createResendSender } from "./resend";
export type { ResendSenderOptions } from "./resend";

export { EmailSendError } from "./sender";
export type { EmailBody, EmailLogger, EmailMessage, EmailSender } from "./sender";

export { escapeHtml, invitationEmail, passwordResetEmail, verificationEmail } from "./templates";
export type { InvitationTemplateOptions, TemplateOptions } from "./templates";
