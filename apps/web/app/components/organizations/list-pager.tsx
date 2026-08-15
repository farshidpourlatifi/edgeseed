import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@starter/ui/components/ui/button";
import type { Pager } from "~/lib/pagination";

export interface ListPagerProps {
  pager: Pager;
  /** Built by the loader, the only place that knows the whole query string. */
  previousUrl: string | null;
  nextUrl: string | null;
  /** Plural noun for the labels — "members", "invitations". */
  label: string;
}

/**
 * One step of a bounded list, as a link when there is somewhere to go and a
 * disabled button when there is not.
 *
 * A link rather than a button because the page number lives in the URL: a page
 * of members can then be linked to, reloaded and opened in a new tab, and Back
 * does the obvious thing.
 */
function Step({
  url,
  children,
  label,
}: {
  url: string | null;
  children: React.ReactNode;
  label: string;
}) {
  if (!url) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={url} preventScrollReset aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}

/**
 * Previous/Next for a bounded list.
 *
 * Renders nothing at all for a single-page list rather than a pair of dead
 * controls — "1 of 1" is not information, and a control that can never do
 * anything is what issue #16 is about. On a real pager the disabled end is
 * different: it says which end of the list you are at.
 */
export function ListPager({ pager, previousUrl, nextUrl, label }: ListPagerProps) {
  if (pager.pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Page {pager.page} of {pager.pageCount} · {pager.total} {label}
      </p>
      <div className="flex gap-2">
        <Step url={previousUrl} label={`Previous page of ${label}`}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Previous
        </Step>
        <Step url={nextUrl} label={`Next page of ${label}`}>
          Next
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Step>
      </div>
    </div>
  );
}
