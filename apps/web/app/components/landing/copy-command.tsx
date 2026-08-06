import { Check, Copy } from "lucide-react";

import { Button } from "@starter/ui/components/ui/button";
import { cn } from "@starter/ui/lib/utils";
import { useCopy } from "./use-copy";

export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const { copied, copy } = useCopy(command);

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
        onClick={copy}
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
