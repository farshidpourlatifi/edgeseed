import { describe, it, expect, vi } from "vitest";
import { createEmailSender } from "../create";
import type { EmailLogger } from "../sender";

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email",
  html: "<p>hi</p>",
  text: "hi",
};

function fakeLogger(): EmailLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn() };
}

/**
 * The transport is picked, not named, so these assert on observable behaviour:
 * Resend means an HTTP call, the fallback means a log line and no HTTP call.
 */
describe("createEmailSender", () => {
  it("should use Resend when both the api key and sender are set", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const logger = fakeLogger();

    await createEmailSender({
      apiKey: "re_key",
      from: "a@b.com",
      logger,
      fetchImpl,
    }).send(MESSAGE);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("should fall back to logging when the api key is missing", async () => {
    const fetchImpl = vi.fn();
    const logger = fakeLogger();

    await createEmailSender({
      from: "a@b.com",
      logger,
      environment: "development",
      fetchImpl,
    }).send(MESSAGE);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("should fall back to logging when the sender is missing", async () => {
    const fetchImpl = vi.fn();
    const logger = fakeLogger();

    await createEmailSender({
      apiKey: "re_key",
      logger,
      environment: "development",
      fetchImpl,
    }).send(MESSAGE);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("should fall back to logging when neither credential is set", async () => {
    const logger = fakeLogger();
    await createEmailSender({ logger, environment: "development" }).send(MESSAGE);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("should include the body in development when falling back", async () => {
    const logger = fakeLogger();
    await createEmailSender({ logger, environment: "development" }).send(MESSAGE);

    expect(logger.info).toHaveBeenCalledWith(
      "email.send.logged",
      expect.objectContaining({ body: MESSAGE.text }),
    );
  });

  it("should withhold the body outside development when falling back", async () => {
    const logger = fakeLogger();
    await createEmailSender({ logger, environment: "production" }).send(MESSAGE);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("should withhold the body when the environment is unset", async () => {
    const logger = fakeLogger();
    await createEmailSender({ logger }).send(MESSAGE);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("should treat an empty api key as absent when picking a transport", async () => {
    const fetchImpl = vi.fn();
    const logger = fakeLogger();

    await createEmailSender({ apiKey: "", from: "a@b.com", logger, fetchImpl }).send(MESSAGE);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
