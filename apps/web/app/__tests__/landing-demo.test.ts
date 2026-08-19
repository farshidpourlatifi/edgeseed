import { describe, it, expect } from "vitest";

import { demoVideo } from "../components/landing/demo";

/**
 * What the landing page builds from a demo-video path.
 *
 * `null` is the branch that matters: it is the state a clone is in once
 * `init:product` clears `PRODUCT_DEMO_VIDEO`, and it is what makes the section
 * absent rather than shipping the starter's branded film (issue #32). The
 * rendered consequence — that the component actually drops out — is in
 * `landing-render.test.ts`.
 */
describe("demoVideo", () => {
  it("returns null when the product declares no film", () => {
    expect(demoVideo("")).toBeNull();
  });

  it("pairs the film with its poster by convention", () => {
    expect(demoVideo("/demo.mp4")).toEqual({
      src: "/demo.mp4",
      poster: "/demo-poster.webp",
    });
  });

  // A clone that drops in its own film names one pair of files and sets one
  // value — the poster follows the source's basename, whatever it is called.
  it("derives the poster from any source basename", () => {
    expect(demoVideo("/walkthrough.webm")).toEqual({
      src: "/walkthrough.webm",
      poster: "/walkthrough-poster.webp",
    });
  });
});
