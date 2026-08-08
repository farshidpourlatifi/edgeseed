/**
 * The inline script that applies the stored theme before first paint.
 *
 * It has to be inline and it has to run before the body renders — a deferred
 * module would paint the wrong theme first, which is the flash this exists to
 * prevent. That makes it the one inline script in the document whose content is
 * fixed, so CSP admits it by **hash** rather than by nonce.
 *
 * Hash, not nonce, on purpose: a nonce has to reach `Layout` through root
 * loader data, and `Layout` also renders on error paths where that data can be
 * absent. A missing nonce here would not throw — it would silently paint the
 * wrong theme. The hash cannot miss, and it keeps this script working
 * independently of the nonce plumbing that React Router's own scripts need.
 *
 * `THEME_SCRIPT_CSP_HASH` is asserted against this string in
 * `app/__tests__/theme-script.test.ts`, so editing the script without
 * regenerating the hash fails the suite instead of breaking the page.
 */
export const THEME_SCRIPT = `
(function() {
  var t = document.cookie.match(/theme=([^;]+)/);
  var theme = t ? t[1] : 'system';
  var isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.add(isDark ? 'dark' : 'light');
})();
`;

/**
 * `sha256-<base64>` of `THEME_SCRIPT`, for the `script-src` directive.
 *
 * Regenerate with the failing message from `theme-script.test.ts`, which prints
 * the expected value — do not hand-edit.
 */
export const THEME_SCRIPT_CSP_HASH = "sha256-GSkVpBMspdeQ3LcGjreevvdbL0662OcG+AA6Hu3YS7w=";
