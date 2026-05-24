"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function DomainAddForm({
  onAdd,
  disabled,
}: {
  onAdd: (domain: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="flex flex-col items-start gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = domain.trim().toLowerCase();
        if (!value || submitting || disabled) return;
        setSubmitting(true);
        try {
          await onAdd(value);
          setDomain("");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="w-[260px] font-mono"
          aria-label="Custom domain"
        />
        <Button type="submit" disabled={submitting || disabled || !domain.trim()}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus size={15} />}
          Add domain
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter only the domain (no protocol). Example: <span className="font-mono">example.com</span>
      </p>
    </form>
  );
}
