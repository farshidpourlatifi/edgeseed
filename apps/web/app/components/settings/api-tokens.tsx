import { useState } from "react";
import { useRevalidator } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Button } from "@starter/ui/components/ui/button";
import { Input } from "@starter/ui/components/ui/input";
import { Label } from "@starter/ui/components/ui/label";
import { Spinner } from "@starter/ui/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@starter/ui/components/ui/alert";
import { toast } from "sonner";

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiTokens({ tokens }: { tokens: ApiTokenSummary[] }) {
  const revalidator = useRevalidator();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Held only until the user navigates away — the server cannot show it again.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/v1/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not create the token");
        return;
      }

      const created = (await res.json()) as { token: string };
      setFreshToken(created.token);
      setName("");
      revalidator.revalidate();
      toast.success("Token created — copy it now");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/v1/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not revoke the token");
        return;
      }
      revalidator.revalidate();
      toast.success("Token revoked");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          Bearer tokens for the CLI and CI. Use with <code>pnpm api:call</code> or an{" "}
          <code>Authorization: Bearer</code> header.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {freshToken && (
          <Alert>
            <AlertTitle>Copy this token now</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>Only its hash is stored — it cannot be shown again.</p>
              <code className="block w-full rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                {freshToken}
              </code>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshToken);
                    toast.success("Copied to clipboard");
                  }}
                >
                  Copy
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setFreshToken(null)}>
                  Dismiss
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="token-name">Token name</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI deploy"
              maxLength={100}
              disabled={isCreating}
            />
          </div>
          <Button type="submit" disabled={isCreating || !name.trim()}>
            {isCreating ? <Spinner className="mr-2 size-4" /> : null}
            Create token
          </Button>
        </form>

        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tokens.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {token.prefix}… · created {formatDate(token.createdAt)} · last used{" "}
                    {formatDate(token.lastUsedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive shrink-0"
                  disabled={revokingId === token.id}
                  onClick={() => void handleRevoke(token.id)}
                >
                  {revokingId === token.id ? <Spinner className="mr-2 size-4" /> : null}
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
