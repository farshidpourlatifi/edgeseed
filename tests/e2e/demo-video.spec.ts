import { test, expect } from "@playwright/test";

/**
 * The landing page's walkthrough film section.
 *
 * Two things matter here and neither is playback (which is flaky to assert in
 * CI): the `<video>` is wired for lazy, poster-first delivery, and — the real
 * acceptance criterion — **no video bytes are fetched until the user presses
 * play**. `preload="none"` plus no autoplay is what makes the ~10 MB asset free
 * to a visitor who scrolls past, so this drives a real browser and inspects the
 * network rather than trusting the attribute alone.
 *
 * `<video>` has no ARIA role Playwright can target, so it is reached by
 * `data-testid` — the sanctioned escape hatch for a role-less element
 * (`tests/e2e/CLAUDE.md`).
 */

test("the demo section renders with a poster-first, lazy-loaded video", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /clone to deployed/i })).toBeVisible();

  const video = page.getByTestId("demo-video");
  await expect(video).toBeAttached();

  // Poster-first and lazy by construction — the attributes that keep the file
  // off the wire until play.
  await expect(video).toHaveAttribute("poster", "/demo-poster.webp");
  await expect(video).toHaveAttribute("preload", "none");
  // Named for assistive tech, and its source is the mp4 the deploy ships.
  await expect(video).toHaveAttribute("aria-label", /walkthrough/i);
  await expect(video.locator("source")).toHaveAttribute("src", "/demo.mp4");

  // The text alternative for anyone who won't press play: one item per beat of
  // the film. A missing list would strand the content behind a control.
  await expect(page.locator("#demo ol > li")).toHaveCount(6);
});

test("no video bytes are fetched before the user presses play", async ({ page }) => {
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/demo.mp4")) videoRequests.push(request.url());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // The poster may load; the film must not. `preload="none"` + no autoplay is
  // the whole point of the section's delivery model.
  const video = page.getByTestId("demo-video");
  await expect(video).toBeAttached();
  expect(videoRequests).toEqual([]);
});
