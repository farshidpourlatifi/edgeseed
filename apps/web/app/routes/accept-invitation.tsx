import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { authClient } from "~/lib/auth-client";
import { INVITATION_ID_PARAM, invitationAuthPath } from "~/lib/auth-redirects";
import {
  invitationFailure,
  invitationFailureCopy,
  invitationSurvivesReauth,
  type InvitationFailure,
  type InvitationScreen,
} from "~/lib/invitation-state";
import { Button } from "@starter/ui/components/ui/button";
import { Card, CardContent, CardHeader } from "@starter/ui/components/ui/card";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import { LinkIcon, Users } from "lucide-react";
import { BrandMark } from "~/components/brand/brand-mark";
import { AuthNotice } from "~/components/auth/auth-notice";
import type { Route } from "./+types/accept-invitation";

/**
 * Spending an organization invitation.
 *
 * **This loader deliberately does not call `requireUser`, and that is the one
 * exception in the app.** Every other loader guards itself because the layout is
 * not a boundary (audit #10) — but this page's whole reason to exist is the
 * signed-out state: the link arrives in a mailbox, and the reader may have no
 * account at all yet. Redirecting them to `/login` would lose the invitation.
 *
 * What keeps that safe is that it returns nothing an anonymous caller did not
 * already supply. Without a session it echoes back the id from the query string
 * and nothing else — no organization name, no inviter, no confirmation that the
 * id is even real. Everything beyond that comes from
 * `auth.api.getInvitation`, which does its own recipient check and refuses any
 * account but the invited one (`crud-invites.mjs`). The deny path is covered in
 * `tests/e2e/invitations.spec.ts`.
 *
 * Accepting is a **button, not the loader**. A GET that mutates would be spent
 * by a link prefetch or a mail-client scanner following the link before the
 * reader ever saw it, and the invitation is single-use.
 */
export async function loader({ context, request }: Route.LoaderArgs): Promise<InvitationScreen> {
  const invitationId = new URL(request.url).searchParams.get(INVITATION_ID_PARAM)?.trim();
  // A blank `?id=` is what a truncated or mangled link produces, and
  // `URLSearchParams` reports it as `""` rather than `null` — so the presence
  // check alone would send an empty id to a server that can only refuse it.
  if (!invitationId) return { kind: "unavailable", reason: "dead" };

  const session = await context.auth.api.getSession({ headers: request.headers });
  if (!session) return { kind: "signed-out", invitationId };

  try {
    const invitation = await context.auth.api.getInvitation({
      query: { id: invitationId },
      headers: request.headers,
    });

    return {
      kind: "ready",
      invitationId,
      organizationName: invitation.organizationName,
      inviterEmail: invitation.inviterEmail,
    };
  } catch (error) {
    // better-call's `APIError` carries `body.code` and a numeric `statusCode`.
    // Normalised here rather than inside the pure module so the same mapping
    // serves the client-side accept below, whose error has a different shape.
    const apiError = error as { body?: { code?: string }; statusCode?: number };
    return {
      kind: "unavailable",
      reason: invitationFailure({ code: apiError.body?.code, status: apiError.statusCode }),
      signedInAs: session.user.email,
      // Carried so the footer can offer a sign-in that comes back here. The
      // invitation may be perfectly alive — `wrong-account` means only that the
      // wrong person is holding it.
      invitationId,
    };
  }
}

export default function AcceptInvitationPage() {
  const state = useLoaderData<typeof loader>();
  const [isLoading, setIsLoading] = useState(false);
  /** Set when the accept POST is refused, replacing the join card in place. */
  const [failure, setFailure] = useState<InvitationFailure | null>(null);

  async function handleAccept(invitationId: string) {
    setIsLoading(true);

    try {
      const { error } = await authClient.organization.acceptInvitation({ invitationId });

      if (error) {
        setFailure(invitationFailure({ code: error.code, status: error.status }));
      } else {
        // Full navigation, not `revalidate()`: accepting writes the session's
        // `activeOrganizationId` server-side (`adapter.setActiveOrganization`),
        // so the dashboard has to be fetched against the updated session rather
        // than rendered from client state that predates it. For the same reason
        // there is no `setActive` call here — the server has already done it.
        window.location.href = "/dashboard";
      }
    } catch {
      setFailure("error");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Shell>
      {failure ? (
        // The accept POST was refused. Only the `ready` state can reach here, so
        // the id is in hand — and a refusal from *this* endpoint is exactly the
        // case where the invitation may still be good for another account.
        <Unavailable
          failure={failure}
          invitationId={state.kind === "ready" ? state.invitationId : undefined}
        />
      ) : state.kind === "signed-out" ? (
        <SignedOut invitationId={state.invitationId} />
      ) : state.kind === "ready" ? (
        <>
          {/* `AuthNotice` rather than `CardTitle`, which renders a plain `<div>`
              — this needs a real `<h2>`, both for a screen reader arriving at a
              page with no other heading and so the e2e suite can select it by
              role instead of by text. */}
          <AuthNotice
            icon={Users}
            title={`Join ${state.organizationName}`}
            description={`${state.inviterEmail} invited you to collaborate.`}
          >
            <Button
              className="h-11 w-full"
              disabled={isLoading}
              onClick={() => handleAccept(state.invitationId)}
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" />
                  Joining...
                </>
              ) : (
                "Accept invitation"
              )}
            </Button>
          </AuthNotice>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/dashboard" className="font-medium text-foreground hover:underline">
              Not now
            </Link>
          </p>
        </>
      ) : (
        <Unavailable
          failure={state.reason}
          signedInAs={state.signedInAs}
          invitationId={state.invitationId}
        />
      )}
    </Shell>
  );
}

/**
 * The signed-out state, and the whole reason this page is not behind a guard.
 *
 * Both links carry the invitation as `?invitation=<id>`, which `/login` and
 * `/register` read to send the reader back here instead of to `/dashboard`.
 * Plain `<Link>`, not `reloadDocument`: all three pages sit on the app origin,
 * so nothing crosses the marketing split.
 */
function SignedOut({ invitationId }: { invitationId: string }) {
  return (
    <>
      <AuthNotice
        icon={Users}
        title="You have been invited to a team"
        description="Sign in with the address the invitation was sent to, or create an account with it, and you will come straight back here."
      >
        <Button asChild className="h-11 w-full">
          <Link to={invitationAuthPath("/login", invitationId)}>Sign in</Link>
        </Button>
      </AuthNotice>
      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          to={invitationAuthPath("/register", invitationId)}
          className="font-medium text-foreground hover:underline"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}

/**
 * Every dead end, following `reset-password.tsx`: no action the reader cannot
 * take, and a sentence that says which of the situations they are actually in.
 */
function Unavailable({
  failure,
  signedInAs,
  invitationId,
}: {
  failure: InvitationFailure;
  signedInAs?: string;
  invitationId?: string;
}) {
  const copy = invitationFailureCopy(failure, signedInAs);
  /**
   * The invitation rides along **only** when signing in as somebody else is the
   * actual remedy — `invitationSurvivesReauth` holds the reasoning. Without it,
   * a reader told to "sign in with a different account" does exactly that and
   * lands on `/dashboard`, having to go back to their mailbox for a link that
   * was working the whole time.
   */
  const carriesInvitation = invitationId && invitationSurvivesReauth(failure);

  return (
    <>
      <AuthNotice
        icon={LinkIcon}
        tone="destructive"
        title={copy.title}
        description={copy.description}
      >
        <Button asChild variant="outline" className="h-11 w-full">
          <Link to="/dashboard">Go to your dashboard</Link>
        </Button>
      </AuthNotice>
      <p className="text-center text-sm text-muted-foreground">
        <Link
          to={carriesInvitation ? invitationAuthPath("/login", invitationId) : "/login"}
          className="font-medium text-foreground hover:underline"
        >
          Sign in with a different account
        </Link>
      </p>
    </>
  );
}

/** The card chrome every state shares, matching `reset-password.tsx`. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          {/* reloadDocument: `/` is the marketing page, which may live on
              another origin — see site-header.tsx and docs/domains.md */}
          <Link reloadDocument to="/" className="mx-auto flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <BrandMark className="h-6 w-6 text-primary-foreground" />
            </div>
          </Link>
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
      </Card>
    </div>
  );
}
