import { test, expect } from "@playwright/test";

/**
 * The landing page must never scroll horizontally.
 *
 * This is a regression guard for a real defect: `Tabs` styled its orientation
 * with `data-horizontal:flex-col`, a shorthand Tailwind does not have, so it
 * emitted **no rule** and the class was silently dropped. The tabs root kept its
 * default `flex-direction: row`, `TabsList` and `TabsContent` sat side by side,
 * the content track collapsed to 0px, and the `<pre>` inside it overflowed —
 * giving the whole page a horizontal scrollbar and clipping the hero background
 * at the viewport edge.
 *
 * Nothing threw and no status changed, which is why it needs a test that
 * measures layout rather than one that checks a response.
 */

const VIEWPORTS = [
  { name: "small phone", width: 320, height: 640 },
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the landing page does not scroll horizontally at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

test("the surfaces tabs stack vertically rather than sitting beside their panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  // The direct assertion on the defect: a row here is what collapsed the panel.
  const tabs = page.locator("#surfaces [data-slot='tabs']");
  await expect(tabs).toHaveCSS("flex-direction", "column");

  // And its consequence — the panel keeps real width to lay its content out in.
  const panelWidth = await page
    .locator("#surfaces [data-slot='tabs-content']:not([hidden])")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(panelWidth).toBeGreaterThan(280);
});

test("a long code sample scrolls inside its own box, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const pre = page.locator("#surfaces pre").first();
  const box = await pre.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));

  expect(box.overflowX).toBe("auto");
  // Its own scroll container absorbs the overflow instead of widening the page.
  expect(box.clientWidth).toBeLessThanOrEqual(375);
});
