import { Briefcase, KeyRound } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  breadcrumbsFor,
  dashboardNavigation,
  isDashboardHome,
  isNavItemActive,
  type NavItem,
} from "../lib/dashboard-nav";

// Built here rather than imported from `product/dashboard-nav.ts`: that file is
// the product's to change, so its contents are not a fixture.
const JOBS: NavItem = { name: "Jobs", href: "/dashboard/jobs", icon: Briefcase };
const API_KEYS: NavItem = { name: "API keys", href: "/dashboard/api-keys", icon: KeyRound };

const names = (items: readonly { name: string }[]) => items.map((item) => item.name);

describe("dashboardNavigation", () => {
  it("lists the starter's entries when the product adds none", () => {
    expect(names(dashboardNavigation([]))).toEqual(["Dashboard", "Members", "Settings"]);
  });

  it("places product entries after Dashboard and before the starter's own, in order", () => {
    const navigation = dashboardNavigation([JOBS, API_KEYS]);

    expect(names(navigation)).toEqual(["Dashboard", "Jobs", "API keys", "Members", "Settings"]);
    expect(navigation.map((item) => item.href)).toEqual([
      "/dashboard",
      "/dashboard/jobs",
      "/dashboard/api-keys",
      "/dashboard/members",
      "/dashboard/settings",
    ]);
  });
});

describe("isDashboardHome", () => {
  it.each(["/dashboard", "/dashboard/"])("is true for %s", (pathname) => {
    expect(isDashboardHome(pathname)).toBe(true);
  });

  it.each(["/dashboard/members", "/", "/dashboard//"])("is false for %s", (pathname) => {
    expect(isDashboardHome(pathname)).toBe(false);
  });
});

describe("isNavItemActive", () => {
  it.each(["/dashboard", "/dashboard/"])("marks the home entry active on %s", (pathname) => {
    expect(isNavItemActive(pathname, "/dashboard")).toBe(true);
  });

  it("does not mark the home entry active on a page beneath it", () => {
    expect(isNavItemActive("/dashboard/members", "/dashboard")).toBe(false);
  });

  it.each(["/dashboard/jobs", "/dashboard/jobs/", "/dashboard/jobs/42"])(
    "marks an entry active on %s",
    (pathname) => {
      expect(isNavItemActive(pathname, "/dashboard/jobs")).toBe(true);
    },
  );

  it.each(["/dashboard/jobs-archive", "/dashboard"])(
    "does not mark an entry active on %s",
    (pathname) => {
      expect(isNavItemActive(pathname, "/dashboard/jobs")).toBe(false);
    },
  );
});

describe("breadcrumbsFor", () => {
  const navigation = dashboardNavigation([JOBS, API_KEYS]);

  it("labels each segment and flags the last one only", () => {
    expect(breadcrumbsFor("/dashboard/members", navigation)).toEqual([
      { name: "Dashboard", href: "/dashboard", isLast: false },
      { name: "Members", href: "/dashboard/members", isLast: true },
    ]);
  });

  it("takes the label from the nav entry at that path", () => {
    expect(breadcrumbsFor("/dashboard/api-keys", navigation)).toEqual([
      { name: "Dashboard", href: "/dashboard", isLast: false },
      { name: "API keys", href: "/dashboard/api-keys", isLast: true },
    ]);
  });

  it("falls back to the capitalised segment where no entry matches", () => {
    expect(breadcrumbsFor("/dashboard/jobs/abc", navigation)).toEqual([
      { name: "Dashboard", href: "/dashboard", isLast: false },
      { name: "Jobs", href: "/dashboard/jobs", isLast: false },
      { name: "Abc", href: "/dashboard/jobs/abc", isLast: true },
    ]);
    expect(names(breadcrumbsFor("/dashboard/api-keys", []))).toEqual(["Dashboard", "Api-keys"]);
  });

  it("yields one crumb for the home with a trailing slash", () => {
    expect(breadcrumbsFor("/dashboard/", navigation)).toEqual([
      { name: "Dashboard", href: "/dashboard", isLast: true },
    ]);
  });
});
