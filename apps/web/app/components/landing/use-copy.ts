import * as React from "react";
import { toast } from "sonner";

/** How long the button shows its confirmed state before reverting. */
const CONFIRM_MS = 2000;

/**
 * Copy-to-clipboard with a transient confirmed state.
 *
 * Shared by the single-line `CopyCommand` and the multi-line code blocks in
 * `Surfaces` — the markup differs, but the behaviour (what the toast says, how
 * long the tick shows, what happens when the clipboard API is unavailable) is
 * one decision that should change in one place.
 */
export function useCopy(text: string): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), CONFIRM_MS);
    } catch {
      // Insecure context, denied permission, or no clipboard API — the text is
      // still on screen and selectable, so say that rather than failing silently.
      toast.error("Could not copy. Select the text and copy manually.");
    }
  }, [text]);

  return { copied, copy };
}
