import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authClient } from "~/lib/auth-client";
import { POST_RESET_REDIRECT } from "~/lib/auth-redirects";
import { resetLinkState } from "~/lib/reset-password-link";
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
import { AlertCircle, LinkIcon } from "lucide-react";
import { BrandMark } from "~/components/brand/brand-mark";
import { AuthNotice } from "~/components/auth/auth-notice";
import { toast } from "sonner";

/** Better Auth's `minPasswordLength` default. Below it the API answers `PASSWORD_TOO_SHORT`. */
const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  // Nobody navigates here by hand: the reader arrives by 302 from
  // `GET /api/auth/reset-password/:token`, carrying either a token or an error.
  const link = resetLinkState(searchParams);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmTouched, setConfirmTouched] = useState(false);

  function validatePasswords() {
    if (confirmPassword && password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return false;
    }
    setPasswordError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (link.kind !== "ready") return;
    if (!validatePasswords()) return;

    setIsLoading(true);

    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token: link.token,
      });

      if (resetError) {
        // Expired, already used, and outright forged all arrive here as the
        // same 400 — better-auth consumes the token on success, so a second
        // submit of a link that worked is indistinguishable from a fake one.
        // Saying "request a new one" is the only useful answer to all three.
        setError(
          resetError.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "That reset link is no longer valid. Request a new one and try again.",
        );
      } else {
        // Full navigation, not a client-side one: `revokeSessionsOnPasswordReset`
        // has just deleted every session for this user, so the document must be
        // re-fetched rather than rendered against stale client state.
        toast.success("Password updated — sign in with your new password");
        window.location.href = POST_RESET_REDIRECT;
      }
    } catch {
      setError("Could not reset your password");
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
          {link.kind === "ready" && (
            <div>
              <CardTitle className="text-2xl">Set a new password</CardTitle>
              <CardDescription>
                Choose a new password for your account. This signs you out everywhere else.
              </CardDescription>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {link.kind === "ready" ? (
            <>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (confirmTouched) {
                        setPasswordError(
                          e.target.value !== confirmPassword && confirmPassword
                            ? "Passwords do not match"
                            : null,
                        );
                      }
                    }}
                    required
                    disabled={isLoading}
                    className="h-11"
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (confirmTouched || e.target.value) {
                        setPasswordError(
                          e.target.value !== password && e.target.value
                            ? "Passwords do not match"
                            : null,
                        );
                      }
                    }}
                    onBlur={() => {
                      setConfirmTouched(true);
                      validatePasswords();
                    }}
                    required
                    disabled={isLoading}
                    className={`h-11 ${passwordError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                  {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full"
                  disabled={isLoading || !!passwordError}
                >
                  {isLoading ? (
                    <>
                      <Spinner className="mr-2" />
                      Updating...
                    </>
                  ) : (
                    "Set New Password"
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              <AuthNotice
                icon={LinkIcon}
                tone="destructive"
                title="This link is not valid"
                description="Reset links expire after an hour and can only be used once. Request a fresh one and it will work."
              >
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link to="/forgot-password">Request a new link</Link>
                </Button>
              </AuthNotice>
              <p className="text-center text-sm text-muted-foreground">
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
