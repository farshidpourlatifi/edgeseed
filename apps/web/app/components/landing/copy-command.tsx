import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@starter/ui/components/ui/button";
import { cn } from "@starter/ui/lib/utils";

export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the command and copy manually.");
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border bg-muted/50 pl-3 pr-1",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto py-3 font-mono text-sm whitespace-nowrap text-foreground">
        <span className="text-muted-foreground select-none">$ </span>
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCopy}
        aria-label={`Copy command: ${command}`}
        className="size-11 shrink-0"
      >
        {copied ? (
          <Check className="size-4 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
