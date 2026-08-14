/**
 * Whether the landing page has a source repository to point at, and what it
 * says when it does.
 *
 * Extracted from the components so the **unset** branch is testable at all: an
 * e2e run can only ever exercise the repo this checkout happens to declare, and
 * the branch that matters for a clone is the one where nothing is declared.
 * Same reason `terminal-timeline.ts` sits beside its component.
 *
 * `null` is deliberately the shape for "no repository" rather than an empty
 * string. A caller cannot render `null` as an href by accident, and every
 * consumer is forced to decide what its section looks like without the link
 * (issue #32).
 */
import { PRODUCT_REPO_URL } from "@starter/config/product";
import { canonicalRepoUrl } from "@starter/config/repo-url";

export type RepoLinks = {
  /** Canonical absolute URL, safe to use as an href. */
  url: string;
  /** The clone line shown in the hero and in step one of getting started. */
  cloneCommand: string;
};

/**
 * The repository affordances for a given URL, or `null` for none.
 *
 * `init:product` refuses an unusable `--repo` at the point of stamping, and
 * this refuses it again at the point of rendering — `product.ts` is a plain
 * source file that a product can also edit by hand, so the page cannot assume
 * the CLI was the last thing to touch it. Both sides call the same
 * `canonicalRepoUrl`, so "what may be stamped" and "what may be rendered"
 * cannot drift apart.
 *
 * The command is interpolated unquoted on purpose: `canonicalRepoUrl` admits no
 * character with meaning to a shell, which `repo.test.ts` asserts directly, so
 * quoting would add noise to a marketing page without adding safety.
 */
export function repoLinks(repoUrl: string): RepoLinks | null {
  const url = canonicalRepoUrl(repoUrl);
  if (!url) return null;

  return { url, cloneCommand: `git clone ${url} my-app` };
}

/** The repository this build declares, or `null`. */
export const REPO = repoLinks(PRODUCT_REPO_URL);
