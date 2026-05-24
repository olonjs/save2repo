"use client";

import { AlertCircle } from "lucide-react";
import type { DomainApiError } from "./types";

function resolveTitle(code?: string | null): string {
  if (code === "ERR_DOMAIN_CONFLICT") return "Domain already connected elsewhere";
  if (code === "ERR_DOMAIN_RATE_LIMITED") return "Too many changes in a short time";
  if (code === "ERR_DOMAIN_LIMIT_REACHED") return "Domain limit reached";
  if (code === "ERR_DOMAIN_ENTITLEMENT_REQUIRED") return "Subscription required";
  if (code === "ERR_DOMAIN_NOT_FOUND") return "Domain not found";
  return "Could not complete domain action";
}

function resolveHint(code?: string | null): string | null {
  if (!code) return null;
  if (code === "ERR_DOMAIN_CONFLICT") {
    return "Remove the domain from the other provider/project, then run Verify again.";
  }
  if (code === "ERR_DOMAIN_RATE_LIMITED") {
    return "Wait a few minutes and retry. Rapid add/remove/verify calls are rate limited.";
  }
  if (code === "ERR_DOMAIN_LIMIT_REACHED") {
    return "This tenant has reached the maximum number of configured domains.";
  }
  if (code === "ERR_DOMAIN_ENTITLEMENT_REQUIRED") {
    return "An active paid license is required to manage custom domains.";
  }
  if (code === "ERR_DOMAIN_NOT_FOUND") {
    return "Refresh the domains list. If still missing, add the domain again.";
  }
  if (code === "ERR_DOMAIN_VERIFY_FAILED") {
    return "DNS may still be propagating. Use Refresh first, then Verify again.";
  }
  if (code === "ERR_DOMAIN_STATUS_FAILED") {
    return "Status sync failed temporarily. Retry Refresh in a moment.";
  }
  return null;
}

export function DomainErrorBanner({ error }: { error: DomainApiError | null }) {
  if (!error) return null;
  const title = resolveTitle(error.code);
  const hint = resolveHint(error.code);
  return (
    <div className="rounded-md border border-red-800/70 bg-red-900/20 p-3 text-sm text-red-200">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-red-100/90">{error.message}</p>
          {error.code && <p className="mt-1 font-mono text-xs text-red-300/80">code: {error.code}</p>}
          {hint && <p className="mt-1 text-xs text-red-100/85">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
