import { test, expect } from "@playwright/test";

import { PRODUCT_REPO_URL } from "@starter/config/product";
import { waitForHydration } from "./helpers";

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

/**
 * The served page points at the repository this build declares, and at nothing
 * else — in whichever state this checkout is in.
 *
 * These run unskipped in a clone that declares none, where every count is
 * asserted to be zero. That matters because the empty case is the one issue #32
 * is about: skipping it here would leave the shipped default untested by the
 * only suite that exercises a real server. The rendered-markup half, which can
 * mock the constant and so can check both states in one run, is
 * `apps/web/app/__tests__/landing-render.test.ts`.
 *
 * The URL is imported rather than written out, so a clone that stamps its own
 * runs these unchanged.
 */
test.describe("repository links", () => {
  test("every outbound link is the declared repository, or there are none", async ({ page }) => {
    await page.goto("/");

    // Every link on the page, then filtered here rather than by an href
    // selector — the point is that nothing outbound escaped notice.
    const outbound = (
      await page
        .getByRole("link")
        .evaluateAll((els) =>
          els.map((el) => ({ href: el.getAttribute("href"), rel: el.getAttribute("rel") })),
        )
    ).filter((link) => link.href?.startsWith("http"));

    if (!PRODUCT_REPO_URL) {
      expect(outbound).toEqual([]);
      return;
    }

    // Hero button and footer link; the header's sits inside the mobile sheet.
    expect(outbound.length).toBeGreaterThanOrEqual(2);
    for (const link of outbound) {
      expect(link.href).toBe(PRODUCT_REPO_URL);
      // An outbound link opening a new tab needs both, or the opened page gets
      // a handle on window.opener.
      expect(link.rel).toContain("noreferrer");
      expect(link.rel).toContain("noopener");
    }
  });

  test("no landing command tells a visitor to clone anything else", async ({ page }) => {
    await page.goto("/");

    const texts = await page.locator("code", { hasText: "git clone" }).allTextContents();

    if (!PRODUCT_REPO_URL) {
      expect(texts).toEqual([]);
      return;
    }

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toContain(`git clone ${PRODUCT_REPO_URL} `);
    }
  });

  /**
   * The fifth affordance, and the only one no other test can see.
   *
   * `site-header.tsx`'s button lives inside a Radix `Sheet` whose open state is
   * component-local, so it is absent from the static markup that
   * `landing-render.test.ts` inspects and from the closed-menu DOM the two
   * tests above walk. Reaching it means opening the menu in a real browser —
   * without this, a hardcoded URL in the header would regress with every other
   * test still green.
   */
  test("the mobile menu's repository button follows the same rule", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    // The trigger is a real click, so React has to own it first — SSR markup is
    // visible and clickable a few hundred ms before hydration attaches.
    const trigger = page.getByRole("button", { name: "Open menu" });
    await waitForHydration(trigger);
    await trigger.click();

    const menu = page.getByRole("dialog");
    await expect(menu).toBeVisible();
    // Proves the sheet really opened, so an absent link below means absent
    // rather than never-rendered. "Sign In" rather than "Get Started" because
    // role-name matching is case-insensitive, and the sheet's nav also carries
    // a "Get started" anchor — the two collide under strict mode.
    await expect(menu.getByRole("link", { name: "Sign In", exact: true })).toBeVisible();

    const repoLink = menu.getByRole("link", { name: "View on GitHub" });

    if (!PRODUCT_REPO_URL) {
      await expect(repoLink).toHaveCount(0);
      return;
    }

    await expect(repoLink).toHaveAttribute("href", PRODUCT_REPO_URL);
    await expect(repoLink).toHaveAttribute("rel", /noreferrer/);
    await expect(repoLink).toHaveAttribute("rel", /noopener/);
  });
});
