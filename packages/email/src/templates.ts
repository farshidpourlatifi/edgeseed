import type { EmailBody } from "./sender";

export interface TemplateOptions {
  /** Absolute action URL minted by Better Auth. */
  url: string;
  /** Product name from `@starter/config/product`, so a rename reaches the emails too. */
  productName: string;
}

/**
 * Better Auth's URLs carry `&callbackURL=...`. A bare `&` in an `href` is
 * invalid HTML and some clients truncate the link there, so escaping is
 * correctness, not defence in depth.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function verificationEmail({ url, productName }: TemplateOptions): EmailBody {
  return {
    subject: `Verify your ${productName} email address`,
    text: [
      `Confirm your email address to finish setting up your ${productName} account:`,
      "",
      url,
      "",
      "This link expires in one hour. If you did not create an account, ignore this email.",
    ].join("\n"),
    html: layout({
      productName,
      heading: "Confirm your email address",
      body: `Confirm your email address to finish setting up your ${escapeHtml(productName)} account.`,
      actionLabel: "Verify email",
      url,
      footer: "This link expires in one hour. If you did not create an account, ignore this email.",
    }),
  };
}

export function passwordResetEmail({ url, productName }: TemplateOptions): EmailBody {
  return {
    subject: `Reset your ${productName} password`,
    text: [
      `Reset the password for your ${productName} account:`,
      "",
      url,
      "",
      "This link expires in one hour. If you did not request a reset, ignore this email — your password is unchanged.",
    ].join("\n"),
    html: layout({
      productName,
      heading: "Reset your password",
      body: `Reset the password for your ${escapeHtml(productName)} account.`,
      actionLabel: "Reset password",
      url,
      footer:
        "This link expires in one hour. If you did not request a reset, ignore this email — your password is unchanged.",
    }),
  };
}

export interface InvitationTemplateOptions extends TemplateOptions {
  /** The organization the reader is being invited into. */
  organizationName: string;
  /**
   * Who sent it. The address rather than the display name, because it is what
   * lets a reader tell an invitation they were expecting from one they were not
   * — a name is chosen by whoever typed it.
   */
  inviterEmail: string;
  /**
   * How long the link stays live, in days.
   *
   * Passed in rather than imported from `@starter/auth`: that package depends on
   * this one, so reaching back would be a cycle. `INVITATION_EXPIRES_IN_DAYS` is
   * the value every caller supplies.
   */
  expiresInDays: number;
}

export function invitationEmail({
  url,
  productName,
  organizationName,
  inviterEmail,
  expiresInDays,
}: InvitationTemplateOptions): EmailBody {
  const plural = expiresInDays === 1 ? "day" : "days";
  const footer =
    `This invitation expires in ${expiresInDays} ${plural}. ` +
    `If you were not expecting it, ignore this email — nothing is shared with you unless you accept.`;

  return {
    subject: `${inviterEmail} invited you to join ${organizationName} on ${productName}`,
    text: [
      `${inviterEmail} invited you to join ${organizationName} on ${productName}.`,
      "",
      url,
      "",
      footer,
    ].join("\n"),
    html: layout({
      productName,
      heading: `Join ${organizationName}`,
      // `layout` inserts `body` raw so a template can emphasise part of it —
      // every interpolation here is escaped at the point of use, the way
      // the two templates above escape `productName`.
      body:
        `${escapeHtml(inviterEmail)} invited you to join ` +
        `<strong>${escapeHtml(organizationName)}</strong> on ${escapeHtml(productName)}.`,
      actionLabel: "Accept invitation",
      url,
      footer,
    }),
  };
}

interface LayoutOptions {
  productName: string;
  heading: string;
  body: string;
  actionLabel: string;
  url: string;
  footer: string;
}

/**
 * One inline-styled layout for every email. Mail clients strip `<style>`
 * blocks and have no CSS variables, so the app's theme tokens cannot be
 * reused here — this is deliberately plain rather than on-brand.
 */
function layout(options: LayoutOptions): string {
  const href = escapeHtml(options.url);
  return [
    `<!doctype html>`,
    `<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a">`,
    `<table role="presentation" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(options.heading)}</h1>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.6">${options.body}</p>`,
    `<a href="${href}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">${escapeHtml(options.actionLabel)}</a>`,
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(options.footer)}</p>`,
    `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280">If the button does not work, paste this into your browser:<br><span style="word-break:break-all">${href}</span></p>`,
    `</td></tr></table>`,
    `<p style="max-width:480px;margin:16px auto 0;font-size:12px;color:#9ca3af;text-align:center">${escapeHtml(options.productName)}</p>`,
    `</body></html>`,
  ].join("");
}
