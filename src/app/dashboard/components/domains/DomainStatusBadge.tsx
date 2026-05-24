"use client";

import { Badge } from "@/components/ui/badge";
import type { DomainStatus } from "./types";

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  if (status === "active") return <Badge variant="success">active</Badge>;
  if (status === "verified") return <Badge variant="success">active</Badge>;
  if (status === "pending_dns") return <Badge variant="warning">pending</Badge>;
  if (status === "verifying") return <Badge variant="warning">verifying</Badge>;
  if (status === "conflict" || status === "error") return <Badge variant="danger">error</Badge>;
  return <Badge variant="default">{status}</Badge>;
}
