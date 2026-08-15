import { describe, it, expect } from "vitest";
import { slugify } from "../lib/org-slug";

/**
 * The suggestion has to be usable without editing for the ordinary case, and
 * honest about the case where a name contains no slug at all — the dialog
 * keeps its submit button disabled on `""`, because better-auth's
 * `/organization/create` requires `slug` to be `min(1)` and a fabricated one is
 * a value the user never chose.
 */

describe("slugify", () => {
  it("turns a display name into the slug most people would have typed", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });

  it("leaves a name that is already a slug unchanged", () => {
    expect(slugify("acme-inc")).toBe("acme-inc");
  });

  it("collapses runs of separators rather than emitting empty segments", () => {
    expect(slugify("Acme   &   Co")).toBe("acme-co");
  });

  it("trims the hyphens that leading and trailing punctuation would leave", () => {
    expect(slugify("  ...Acme...  ")).toBe("acme");
  });

  /**
   * NFKD splits "é" into `e` + a combining accent, so stripping the combining
   * marks folds the letter instead of deleting it. Removing the whole
   * character would give `caf-nordique` here.
   */
  it("folds diacritics to their base letters instead of dropping them", () => {
    expect(slugify("Café Nordique")).toBe("cafe-nordique");
  });

  it("keeps digits, which are legal in a slug", () => {
    expect(slugify("Studio 54")).toBe("studio-54");
  });

  /**
   * Load-bearing for the dialog, which runs this over the **displayed** value —
   * a suggestion it produced itself, or the user's own text. If a second pass
   * could change an already-clean slug, the field would settle on one value and
   * submit another.
   */
  it("is idempotent, so a second pass over its own output changes nothing", () => {
    for (const input of ["Acme Inc", "  ...Café & Co...  ", "###", "a".repeat(80), "Studio 54"]) {
      expect(slugify(slugify(input))).toBe(slugify(input));
    }
  });

  /**
   * The whole reason hand-edited slugs are normalised rather than trusted: the
   * unique index carries no `COLLATE NOCASE`, so SQLite compares slugs binary
   * and `Northwind-Trading` would coexist with `northwind-trading`.
   */
  it("folds case, so two spellings cannot become two organizations", () => {
    expect(slugify("Northwind-Trading")).toBe(slugify("northwind-trading"));
  });

  it("caps the suggestion rather than proposing a URL nobody wants", () => {
    expect(slugify("a".repeat(80))).toHaveLength(48);
  });

  /**
   * The cap is applied before the trailing trim, so a truncation landing on a
   * separator cannot leave a dangling hyphen. `"ab "` repeated puts a space at
   * character 48 exactly.
   */
  it("never ends in a hyphen when the cap truncates mid-word", () => {
    const slug = slugify("ab ".repeat(40));
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(48);
  });

  /**
   * The deny path. A name with no alphanumerics in it has no slug in it, and
   * the caller must not be handed something submittable.
   */
  it("returns an empty string when nothing survives", () => {
    expect(slugify("###")).toBe("");
  });

  it("returns an empty string for an empty name", () => {
    expect(slugify("")).toBe("");
  });

  it("returns an empty string for a name of only whitespace", () => {
    expect(slugify("   ")).toBe("");
  });

  /**
   * Non-Latin scripts have no ASCII fold, so they reduce to nothing and the
   * user is asked for a slug explicitly. That is the honest outcome — the
   * alternative is transliteration, which guesses at a romanisation the owner
   * of the name may not agree with.
   */
  it("returns an empty string for a name with no ASCII to fold to", () => {
    expect(slugify("株式会社")).toBe("");
  });
});
