export type DomainStatus =
  | "pending_dns"
  | "verifying"
  | "verified"
  | "active"
  | "conflict"
  | "error"
  | "deleted";

export type DomainCheck = {
  type: string | null;
  domain: string | null;
  value: string | null;
  reason: string | null;
  required?: boolean | null;
};

export type CloudflareStatus = "pending_ns" | "active" | "error" | "disconnected";

export type DomainRecord = {
  id: string;
  domain: string;
  status: DomainStatus;
  verification_method?: string;
  verification_targets?: { checks?: DomainCheck[] } | Record<string, unknown> | null;
  verificationTargets?: { checks?: DomainCheck[] } | Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  verified_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  cf_zone_id?: string | null;
  cf_nameservers?: string[] | null;
  cf_status?: CloudflareStatus | null;
  cf_attached_at?: string | null;
  cf_last_error_code?: string | null;
  cf_last_error_message?: string | null;
};

export type DomainApiError = {
  message: string;
  code?: string | null;
  status?: number;
};

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "NS"
  | "SRV"
  | "CAA";

export type DnsRecord = {
  id: string;
  type: DnsRecordType | string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  proxiable?: boolean;
  priority?: number;
  platform_managed?: boolean;
};

export type DnsRecordInput = {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
};
