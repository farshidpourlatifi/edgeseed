import { describe, it, expect } from "vitest";
import { escapeHtml, passwordResetEmail, verificationEmail } from "../templates";

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
