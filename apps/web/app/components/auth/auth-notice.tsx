import type { LucideIcon } from "lucide-react";

interface AuthNoticeProps {
  /** Lucide icon for the badge. Rendered `aria-hidden` — the heading carries the meaning. */
  icon: LucideIcon;
  /** Rendered as the `<h2>`. E2E locators resolve these by role, so treat one as API. */
  title: string;
  description: React.ReactNode;
  /**
   * `destructive` for a state the reader has to act on differently — a dead
   * link, not a delivered one. Only the badge changes; the copy below carries
   * the actual explanation.
   */
  tone?: "primary" | "destructive";
  /** Actions and alerts below the copy. */
  children?: React.ReactNode;
}

/**
 * The "the form is done, here is what happened" panel that replaces an auth
 * form once it has been submitted.
 *
 * Extracted when the second and third of these arrived together (reset
 * requested, reset link dead) alongside the original check-your-email notice.
 * It is layout only — each caller keeps its own copy and actions, because what
 * those say is not shared knowledge, it just happens to sit in the same box.
 *
 * Lives here rather than in `@starter/ui` on purpose: it is a product
 * composite, not a generic primitive (`docs/design-workflow.md`).
 */
export function AuthNotice({
  icon: Icon,
  title,
  description,
  tone = "primary",
  children,
}: AuthNoticeProps) {
  const badge =
    tone === "destructive"
      ? { wrapper: "bg-destructive/10", icon: "text-destructive" }
      : { wrapper: "bg-primary/10", icon: "text-primary" };

  return (
    <div className="space-y-6 text-center">
      <div
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${badge.wrapper}`}
      >
        <Icon className={`h-6 w-6 ${badge.icon}`} aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {children}
    </div>
  );
}
