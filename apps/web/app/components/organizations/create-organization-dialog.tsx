import { useState } from "react";
import { useRevalidator } from "react-router";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@starter/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@starter/ui/components/ui/dialog";
import { Input } from "@starter/ui/components/ui/input";
import { Label } from "@starter/ui/components/ui/label";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@starter/ui/components/ui/tooltip";
import { cn } from "@starter/ui/lib/utils";
import { authClient } from "~/lib/auth-client";
import { slugify } from "~/lib/org-slug";

/**
 * Creating an organization — the whole form, in one place.
 *
 * Two surfaces open it and neither owns it: the sidebar's organization switcher
 * (and, for an account with none, the control that stands in for the switcher),
 * and the first-run empty state on `/dashboard`. The sidebar is `hidden md:block`,
 * so the dashboard card is the only path on a phone.
 *
 * Three things about better-auth 1.6.26 are load-bearing here, all verified in
 * `plugins/organization/routes/crud-org.mjs` rather than remembered:
 *
 * 1. **`slug` is required and never derived.** The body schema is `name` and
 *    `slug`, both `z.string().min(1)`. `slugify` is what fills the gap, and an
 *    empty result keeps the submit button disabled rather than sending a value
 *    the server would refuse.
 * 2. **The new organization is already made active, server-side** — the handler
 *    ends in `setActiveOrganization(session.token, organization.id)` unless
 *    `keepCurrentActiveOrganization` is passed, and that writes the session row
 *    in D1. Calling `authClient.organization.setActive` afterwards would be a
 *    redundant round trip that reads as though the server had not done it.
 *    `revalidate()` is what puts the result on screen, because the switcher and
 *    the empty state both render from the dashboard *layout* loader.
 * 3. **A colliding slug is `400 ORGANIZATION_ALREADY_EXISTS`** (not
 *    `ORGANIZATION_SLUG_ALREADY_TAKEN`, which belongs to `/organization/check-slug`
 *    and `/organization/update`). It is surfaced under the slug field with the
 *    dialog left open and the values intact — a toast-and-close would throw away
 *    the name the user typed to tell them one field needs an edit.
 *
 * `/organization/create` falls into the `default` rate-limit class (120/60s):
 * `CLASSIFIERS` in `packages/auth/src/rate-limit.ts` does not name it, and it
 * sends no mail and takes no credentials, so the loose bucket is the right one.
 */

/** better-auth's code for a slug that is already in use on create. */
const SLUG_TAKEN = "ORGANIZATION_ALREADY_EXISTS";

export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revalidator = useRevalidator();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /**
   * Whether the slug is the user's own. Until they edit it, it tracks the name;
   * afterwards the link is broken for good, because silently overwriting a
   * hand-typed slug on the next keystroke in the name field is the bug this
   * flag exists to avoid.
   */
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const trimmedName = name.trim();
  /**
   * What the field shows: the user's own text while they are editing it, the
   * suggestion from the name otherwise. Deliberately *not* normalised on every
   * keystroke — `slugify` trims trailing hyphens, so live normalisation eats
   * the separator the moment it is typed and "north west" can never be reached.
   * `handleSlugBlur` settles the field instead.
   */
  const displayedSlug = slugTouched ? slug : slugify(name);
  /**
   * What is actually sent. **Every** slug goes through `slugify`, hand-edited
   * ones included: the unique index is `CREATE UNIQUE INDEX
   * organization_slug_unique ON organization (slug)` with no `COLLATE NOCASE`,
   * so SQLite compares it binary and better-auth's `findOrganizationBySlug`
   * does an exact match. Submitting a hand-typed `Northwind-Trading` would sit
   * happily beside `northwind-trading` and never raise
   * `ORGANIZATION_ALREADY_EXISTS` — two organizations the app renders
   * identically. Case is only the visible half: the raw field would also admit
   * spaces and slashes straight into a URL segment.
   *
   * `slugify` is idempotent, so running it over an already-suggested value
   * changes nothing.
   */
  const submittedSlug = slugify(displayedSlug);
  const canSubmit = trimmedName.length > 0 && submittedSlug.length > 0;

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
  }

  /**
   * Settle the field on what will actually be sent, once the user has finished
   * typing. Without this the dialog shows `Northwind-Trading` and creates
   * `northwind-trading`, which is the profile form's lesson in another costume:
   * a field must not claim a value the account does not hold.
   */
  function handleSlugBlur() {
    if (slugTouched) setSlug(submittedSlug);
  }

  /**
   * Closing discards the draft. Re-opening onto a half-filled form from a
   * previous attempt — including its stale error — reads as though the create
   * had half happened. A submit in flight holds the dialog open instead.
   */
  function handleOpenChange(next: boolean) {
    if (isCreating) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || isCreating) return;

    setIsCreating(true);
    setError(null);
    try {
      const { error: createError } = await authClient.organization.create({
        name: trimmedName,
        slug: submittedSlug,
      });

      if (createError) {
        setError(
          createError.code === SLUG_TAKEN
            ? "That slug is already taken. Try another."
            : (createError.message ?? "Could not create the organization"),
        );
        return;
      }

      // The switcher, the sidebar and the dashboard empty state all render from
      // the dashboard layout loader, so the new organization is invisible until
      // every loader re-runs. Awaiting it means the toast only fires once the
      // organization is on screen.
      await revalidator.revalidate();
      reset();
      onOpenChange(false);
      toast.success(`${trimmedName} created`);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Organizations own members and data. You will be its owner.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="organization-name">Name</Label>
            <Input
              id="organization-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
              maxLength={100}
              autoComplete="organization"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="organization-slug">Slug</Label>
            <Input
              id="organization-slug"
              value={displayedSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
                setError(null);
              }}
              onBlur={handleSlugBlur}
              disabled={isCreating}
              maxLength={48}
              aria-describedby={error ? "organization-slug-error" : "organization-slug-help"}
              aria-invalid={error ? true : undefined}
              className="h-11"
            />
            {error ? (
              <p id="organization-slug-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <p id="organization-slug-help" className="text-xs text-muted-foreground">
                Used in URLs — lowercase letters, numbers and hyphens. Suggested from the name until
                you edit it.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isCreating}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isCreating} className="min-h-[44px]">
              {isCreating ? (
                <>
                  <Spinner className="mr-2" />
                  Creating...
                </>
              ) : (
                "Create organization"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A button that opens the dialog, for the surfaces that need one.
 *
 * The switcher's dropdown does **not** use this — a dialog mounted inside a
 * `DropdownMenuItem` is unmounted the moment the menu closes, so that surface
 * drives `CreateOrganizationDialog` from its own state with the dialog as a
 * sibling of the menu.
 *
 * `collapsed` mirrors the sidebar nav items: icon plus a tooltip carrying the
 * label, so narrowing the sidebar does not take the action away with the text.
 */
export function CreateOrganizationButton({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button
      variant="outline"
      onClick={() => setOpen(true)}
      aria-label="Create organization"
      className={cn(
        "min-h-[44px]",
        collapsed ? "w-full px-2" : "w-full justify-start gap-2",
        className,
      )}
    >
      {collapsed ? (
        <Plus className="h-4 w-4" aria-hidden="true" />
      ) : (
        <>
          <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Create organization</span>
        </>
      )}
    </Button>
  );

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Create organization</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <CreateOrganizationDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
