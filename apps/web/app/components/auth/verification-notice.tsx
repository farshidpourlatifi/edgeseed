import { useState } from "react";
import { authClient } from "~/lib/auth-client";
import { Button } from "@starter/ui/components/ui/button";
import { Alert, AlertDescription } from "@starter/ui/components/ui/alert";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { MailCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface VerificationNoticeProps {
  /** Where the link was sent. Shown back to the reader so a typo is obvious. */
  email: string;
}

/**
 * Shared by the two places a verification link goes unused: straight after
 * sign-up, and after a sign-in refused for an unverified address. The resend
 * action is the same knowledge in both, so it lives here rather than twice.
 */
export function VerificationNotice({ email }: VerificationNoticeProps) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    setError(null);
    setIsSending(true);
    try {
      const { error: resendError } = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/dashboard",
      });
      if (resendError) {
        setError(resendError.message ?? "Could not send the email");
      } else {
        toast.success("Verification email sent");
      }
    } catch {
      setError("Could not send the email");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Follow it to finish signing
          in.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button variant="outline" className="h-11 w-full" onClick={handleResend} disabled={isSending}>
        {isSending ? (
          <>
            <Spinner className="mr-2" />
            Sending...
          </>
        ) : (
          "Resend verification email"
        )}
      </Button>
    </div>
  );
}
