/**
 * Product-owned: the starter ships this file once and does not edit it again,
 * so changing it never conflicts with a starter update.
 *
 * The route module rendered at `/`, as a path relative to `app/`. To replace
 * the landing page, put your module in `app/product/` and name it here; leave
 * the starter's `routes/_index.tsx` and `components/landing/` in place.
 *
 * What the e2e suite still expects of `/`: exactly one level-1 heading, and it
 * is visible; no horizontal scroll from 320 to 1280px wide. Specs about the
 * starter's own marketing skip themselves once this names another module.
 * `SiteHeader` and `SiteFooter` take a product's links as props.
 *
 * Only relative imports of plain modules here: `app/routes.ts` and Playwright
 * both load this file in Node.
 */
import { STARTER_LANDING_ROUTE } from "../lib/starter-landing";

export const LANDING_ROUTE: string = STARTER_LANDING_ROUTE;
