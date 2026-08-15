import { describe, it, expect } from "vitest";
import {
  correctedPageUrl,
  offsetFor,
  PAGE_SIZE,
  pageCountFor,
  pageLink,
  pagerFor,
  readPage,
} from "../lib/pagination";

/**
 * The loader that uses these has no unit target, and none of this is visible in
 * a rendered page with three members in it: an offset that skips a row, a
 * "Next" on the last page, or `?members=0` reaching D1 as a negative `OFFSET`
 * all look like a working page until the list is longer than one screen.
 */

const url = (search: string) => new URL(`https://app.example/dashboard/members${search}`);

describe("readPage", () => {
  it("reads a whole number", () => {
    expect(readPage("3")).toBe(3);
  });

  it.each([
    ["absent", null],
    ["undefined", undefined],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "2.5"],
    ["not a number", "abc"],
    ["exponential", "1e3"],
    ["padded", " 2 "],
  ])("refuses %s and falls back to the first page", (_label, value) => {
    expect(readPage(value)).toBe(1);
  });
});

describe("offsetFor", () => {
  it("starts the first page at zero", () => {
    expect(offsetFor(1, 20)).toBe(0);
  });

  it("skips whole pages", () => {
    expect(offsetFor(3, 20)).toBe(40);
  });

  it("defaults to the shared page size", () => {
    expect(offsetFor(2)).toBe(PAGE_SIZE);
  });
});

describe("pageCountFor", () => {
  it("counts a partial last page", () => {
    expect(pageCountFor(21, 20)).toBe(2);
  });

  it("does not add a page when the last one is exactly full", () => {
    expect(pageCountFor(40, 20)).toBe(2);
  });

  it("reports one page for an empty list, never zero", () => {
    expect(pageCountFor(0, 20)).toBe(1);
  });
});

describe("pagerFor", () => {
  it("has no previous on the first page", () => {
    expect(pagerFor(1, 50, 20)).toMatchObject({ page: 1, hasPrevious: false, hasNext: true });
  });

  it("has no next on the last page", () => {
    expect(pagerFor(3, 50, 20)).toMatchObject({ page: 3, hasPrevious: true, hasNext: false });
  });

  it("has neither when everything fits on one page", () => {
    expect(pagerFor(1, 5, 20)).toMatchObject({
      page: 1,
      pageCount: 1,
      hasPrevious: false,
      hasNext: false,
    });
  });

  it("clamps a page past the end so the pager cannot claim a page that is not there", () => {
    expect(pagerFor(99, 50, 20)).toMatchObject({ page: 3, pageCount: 3, hasNext: false });
  });

  it("carries the total through for the caller's label", () => {
    expect(pagerFor(1, 50, 20).total).toBe(50);
  });
});

describe("correctedPageUrl", () => {
  it("returns null when every page exists", () => {
    expect(
      correctedPageUrl(url("?members=2"), [{ param: "members", requested: 2, pageCount: 3 }]),
    ).toBeNull();
  });

  it("pulls an over-shooting page back to the last real one", () => {
    expect(
      correctedPageUrl(url("?members=99"), [{ param: "members", requested: 99, pageCount: 3 }]),
    ).toBe("/dashboard/members?members=3");
  });

  it("drops the parameter entirely when there is only one page", () => {
    expect(
      correctedPageUrl(url("?members=99"), [{ param: "members", requested: 99, pageCount: 1 }]),
    ).toBe("/dashboard/members");
  });

  it("corrects both lists in one redirect, so the browser cannot bounce twice", () => {
    expect(
      correctedPageUrl(url("?members=99&invitations=99"), [
        { param: "members", requested: 99, pageCount: 3 },
        { param: "invitations", requested: 99, pageCount: 2 },
      ]),
    ).toBe("/dashboard/members?members=3&invitations=2");
  });

  it("leaves a healthy list alone while correcting its neighbour", () => {
    expect(
      correctedPageUrl(url("?members=2&invitations=99"), [
        { param: "members", requested: 2, pageCount: 3 },
        { param: "invitations", requested: 99, pageCount: 2 },
      ]),
    ).toBe("/dashboard/members?members=2&invitations=2");
  });
});

describe("pageLink", () => {
  it("keeps the other list where it is", () => {
    expect(pageLink(url("?members=2&invitations=4"), "members", 3)).toBe(
      "/dashboard/members?members=3&invitations=4",
    );
  });

  it("drops the parameter on the way back to the first page, rather than writing =1", () => {
    expect(pageLink(url("?members=2"), "members", 1)).toBe("/dashboard/members");
  });

  it("preserves unrelated search parameters", () => {
    expect(pageLink(url("?tab=team"), "members", 2)).toBe("/dashboard/members?tab=team&members=2");
  });
});
