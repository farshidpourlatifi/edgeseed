import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  invitationEmail,
  passwordResetEmail,
  verificationEmail,
  type TemplateOptions,
} from "../templates";

/** `invitationEmail` needs more than the shared two, so it joins the each below wrapped. */
const invitationWithDefaults = (options: TemplateOptions) =>
  invitationEmail({
    ...options,
    organizationName: "Northwind Trading",
    inviterEmail: "owner@example.com",
    expiresInDays: 7,
  });

/** The shape Better Auth actually produces — the `&` is the whole point. */
const URL_WITH_CALLBACK = "https://app.test/api/auth/verify-email?token=abc123&callbackURL=%2F";

describe("escapeHtml", () => {
  it("should escape every HTML-significant character when given one", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("should escape ampersands before the entities it introduces", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("should leave a string with nothing to escape unchanged", () => {
    expect(escapeHtml("https://app.test/verify")).toBe("https://app.test/verify");
  });
});

describe.each([
  ["verificationEmail", verificationEmail],
  ["passwordResetEmail", passwordResetEmail],
  ["invitationEmail", invitationWithDefaults],
] as const)("%s", (_name, template) => {
  const body = template({ url: URL_WITH_CALLBACK, productName: "Starter" });

  it("should name the product in the subject", () => {
    expect(body.subject).toContain("Starter");
  });

  it("should put the raw url in the text part", () => {
    expect(body.text).toContain(URL_WITH_CALLBACK);
  });

  it("should escape the url in the html part so the link survives mail clients", () => {
    expect(body.html).toContain("token=abc123&amp;callbackURL=%2F");
    expect(body.html).not.toContain("token=abc123&callbackURL=%2F");
  });

  it("should offer the url as pasteable text as well as a button", () => {
    // Once in the href, once in the copy-paste fallback.
    const occurrences = body.html.split("token=abc123&amp;callbackURL=%2F").length - 1;
    expect(occurrences).toBe(2);
  });

  it("should tell the recipient what to do if they did not ask for it", () => {
    expect(body.text.toLowerCase()).toContain("ignore this email");
    expect(body.html.toLowerCase()).toContain("ignore this email");
  });
});

describe("verificationEmail", () => {
  it("should escape a product name containing markup", () => {
    const body = verificationEmail({ url: "https://a.test", productName: "<script>x</script>" });
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });
});

describe("passwordResetEmail", () => {
  it("should reassure the reader that ignoring it leaves the password unchanged", () => {
    const body = passwordResetEmail({ url: "https://a.test", productName: "Starter" });
    expect(body.text).toContain("your password is unchanged");
  });
});

describe("invitationEmail", () => {
  const base = {
    url: "https://app.test/accept-invitation?id=inv_1",
    productName: "Starter",
    organizationName: "Northwind Trading",
    inviterEmail: "owner@example.com",
    expiresInDays: 7,
  };

  /**
   * The subject is the whole of what most recipients see before deciding. Both
   * facts belong there: an organization name alone does not say who sent it, and
   * an unexpected invitation is exactly the one worth spotting from the list.
   */
  it("should name the inviter and the organization in the subject", () => {
    const body = invitationEmail(base);

    expect(body.subject).toContain("owner@example.com");
    expect(body.subject).toContain("Northwind Trading");
    expect(body.subject).toContain("Starter");
  });

  it("should state the expiry it was given rather than a hardcoded one", () => {
    expect(invitationEmail(base).text).toContain("expires in 7 days");
    expect(invitationEmail({ ...base, expiresInDays: 30 }).text).toContain("expires in 30 days");
  });

  it("should say day, not days, for a one-day window", () => {
    expect(invitationEmail({ ...base, expiresInDays: 1 }).text).toContain("expires in 1 day.");
  });

  /**
   * `layout` inserts `body` raw so a template can emphasise part of it, which
   * makes every interpolation there the template's own responsibility. An
   * organization name is attacker-supplied — anyone who can create an
   * organization chooses it — so this is the one that actually matters.
   */
  it("should escape an organization name containing markup", () => {
    const body = invitationEmail({ ...base, organizationName: "<script>x</script>" });

    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("should escape an inviter address containing markup", () => {
    const body = invitationEmail({ ...base, inviterEmail: "<img src=x onerror=y>@e.test" });

    expect(body.html).not.toContain("<img");
    expect(body.html).toContain("&lt;img");
  });

  it("should tell the reader that ignoring it shares nothing with them", () => {
    expect(invitationEmail(base).text).toContain("nothing is shared with you unless you accept");
  });
});
