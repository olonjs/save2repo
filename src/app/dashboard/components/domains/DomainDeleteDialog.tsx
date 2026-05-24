"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DomainDeleteDialog({
  domain,
  onConfirm,
  disabled,
}: {
  domain: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Trash2 size={14} />
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove domain</DialogTitle>
          <DialogDescription>
            This will detach <span className="font-mono text-foreground">{domain}</span> from the tenant.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="destructive"
            onClick={async () => {
              await onConfirm();
            }}
            disabled={disabled}
          >
            {disabled ? <Loader2 className="size-4 animate-spin" /> : <Trash2 size={14} />}
            Confirm remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
