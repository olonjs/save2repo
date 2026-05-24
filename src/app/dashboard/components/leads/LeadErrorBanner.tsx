"use client";

import { AlertCircle } from "lucide-react";
import type { LeadApiError } from "./types";

export function LeadErrorBanner({ error }: { error: LeadApiError | null }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-800/70 bg-red-900/20 p-3 text-sm text-red-200">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Could not complete leads operation</p>
          <p className="mt-1 text-red-100/90">{error.message}</p>
          {error.code && <p className="mt-1 font-mono text-xs text-red-300/80">code: {error.code}</p>}
        </div>
      </div>
    </div>
  );
}
