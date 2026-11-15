import { LayoutDashboard, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = { name: string; href: string; icon: LucideIcon };

export type Breadcrumb = { name: string; href: string; isLast: boolean };

export const DASHBOARD_HOME_PATH = "/dashboard";

/**
 * The dashboard's navigation: the home, then the product's entries in the
 * order it lists them, then the starter's own pages.
 */
export function dashboardNavigation(productNav: readonly NavItem[]): NavItem[] {
  return [
    { name: "Dashboard", href: DASHBOARD_HOME_PATH, icon: LayoutDashboard },
    ...productNav,
    { name: "Members", href: "/dashboard/members", icon: Users },
    { name: "Settings", href: "/dashboard/settings", icon: Settings },
  ];
}

/** One trailing slash is the same page; React Router matches both. */
function withoutTrailingSlash(pathname: string): string {
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function isDashboardHome(pathname: string): boolean {
  return withoutTrailingSlash(pathname) === DASHBOARD_HOME_PATH;
}

/**
 * The home is active on itself only, since every dashboard page sits beneath
 * it. Any other entry is active on its path and on anything beneath it; the
 * `/` in the prefix keeps `/dashboard/jobs` off `/dashboard/jobs-archive`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === DASHBOARD_HOME_PATH) return isDashboardHome(pathname);
  const path = withoutTrailingSlash(pathname);
  return path === href || path.startsWith(`${href}/`);
}

/**
 * One crumb per path segment. A segment that is a nav entry's path takes that
 * entry's name; any other is the segment itself, capitalised.
 */
export function breadcrumbsFor(
  pathname: string,
  nav: readonly Pick<NavItem, "name" | "href">[],
): Breadcrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const name =
      nav.find((item) => item.href === href)?.name ??
      segment.charAt(0).toUpperCase() + segment.slice(1);
    return { name, href, isLast: index === segments.length - 1 };
  });
}
