/**
 * The slug an organization name suggests.
 *
 * Better Auth does **not** derive one: `POST /organization/create` takes `name`
 * and `slug` as two required `z.string().min(1)` fields (better-auth
 * `plugins/organization/routes/crud-org.mjs`), so the client is what turns a
 * display name into a URL-safe identifier. `organization.slug` is unique, and
 * the collision is reported one round trip later as
 * `400 ORGANIZATION_ALREADY_EXISTS` — this function only has to produce a
 * plausible candidate, never a guaranteed-free one.
 *
 * Pure and separate from the dialog so the transformation is unit- and
 * mutation-tested. A component test would prove far less for far more setup.
 */

/**
 * Longest slug this will suggest.
 *
 * Nothing in the schema caps it — `organization.slug` is an unbounded `text`
 * column — so this is a readability bound, not a validity one. It exists
 * because the name field accepts far more than anyone wants to see in a URL,
 * and a suggestion the user immediately has to shorten is a worse default than
 * a short one they can lengthen.
 */
const MAX_LENGTH = 48;

/**
 * Suggest a slug for `name`.
 *
 * Diacritics are folded rather than dropped — NFKD splits "Café" into `Cafe` +
 * a combining accent, so stripping the combining marks leaves `cafe` instead of
 * the `caf-` that removing the whole character would give. Everything else
 * outside `[a-z0-9]` becomes a separator, runs collapse, and the result is
 * trimmed of leading and trailing hyphens.
 *
 * **Returns `""` when nothing survives** — a name of only symbols ("###") has
 * no slug in it, and inventing one would put a value the user never chose
 * behind a field they are about to submit. The caller keeps the submit button
 * disabled instead, which is also what the server's `min(1)` requires.
 *
 * The trailing trim happens **after** the length cap, so truncating mid-word
 * cannot leave a dangling hyphen.
 */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      // Combining diacritical marks, written as escapes: the literal characters
      // are invisible in a diff and in most editors.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, MAX_LENGTH)
      // Single hyphens, not `-+`: the collapse above leaves no two adjacent, and
      // `slice` only ever takes a prefix of that, so a `+` here would be an
      // unreachable branch. It reads as defensive and is really just noise — a
      // surviving mutant every run, with nothing to assert that would kill it.
      .replace(/^-|-$/g, "")
  );
}
