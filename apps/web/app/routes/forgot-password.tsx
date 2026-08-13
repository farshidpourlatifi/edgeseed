import { useState } from "react";
import { Link } from "react-router";
import { authClient } from "~/lib/auth-client";
import { PASSWORD_RESET_REDIRECT } from "~/lib/auth-redirects";
import { Button } from "@starter/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Input } from "@starter/ui/components/ui/input";
import { Label } from "@starter/ui/components/ui/label";
import { Alert, AlertDescription } from "@starter/ui/components/ui/alert";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import { AlertCircle, MailCheck } from "lucide-react";
import { BrandMark } from "~/components/brand/brand-mark";
import { AuthNotice } from "~/components/auth/auth-notice";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the request is accepted — swaps the form for the neutral notice. */
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { error: requestError } = await authClient.requestPasswordReset({
        email,
        redirectTo: PASSWORD_RESET_REDIRECT,
      });

      // Surfacing this is enumeration-safe, which is worth stating because it
      // looks like it should not be: better-auth answers `/request-password-reset`
      // 200 with the same body whether or not the account exists, and even
      // simulates the token generation to level the timing. So anything that
      // reaches here — a 429, a network failure — is independent of the address.
      //
      // A failed *send* is not in that set and never reaches here: better-auth
      // wraps `sendResetPassword` in `runInBackgroundOrAwait`, which catches
      // and logs, so an unconfigured or rejecting Resend still answers 200.
      // Nothing this screen can do changes that — see ADR 003.
      if (requestError) {
        setError(
          requestError.status === 429
            ? "Too many reset requests. Wait a minute and try again."
            : (requestError.message ?? "Could not send the reset email"),
        );
      } else {
        setSubmittedEmail(email);
      }
    } catch {
      setError("Could not send the reset email");
    } finally {
      setIsLoading(false);
    }
  }

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
          {!submittedEmail && (
            <div>
              <CardTitle className="text-2xl">Forgot your password?</CardTitle>
              <CardDescription>
                Enter your email and we&apos;ll send you a link to set a new one
              </CardDescription>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {submittedEmail ? (
            <>
              {/*
                Worded around the address, never around the account. "If an
                account exists" is the whole enumeration defence at the UI
                layer — better-auth refuses to say, so this must not say it
                either by claiming mail was sent.
              */}
              <AuthNotice
                icon={MailCheck}
                title="Check your email"
                description={
                  <>
                    If an account exists for{" "}
                    <span className="font-medium text-foreground">{submittedEmail}</span>, we sent
                    it a link to reset the password. It expires in one hour.
                  </>
                }
              >
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => setSubmittedEmail(null)}
                >
                  Use a different address
                </Button>
              </AuthNotice>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-foreground hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11"
                  />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Spinner className="mr-2" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Remembered it?{" "}
                <Link to="/login" className="font-medium text-foreground hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
