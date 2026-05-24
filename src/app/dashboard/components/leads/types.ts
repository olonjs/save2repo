export type LeadDeliveryStatus = "received" | "sent" | "delivered" | "warning" | "error";

export type LeadRecord = {
  id: string;
  tenant_id: string;
  data?: Record<string, unknown> | null;
  source_ip?: string | null;
  user_agent?: string | null;
  resend_id?: string | null;
  delivery_status: LeadDeliveryStatus;
  storage_mode?: string | null;
  correlation_id?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type LeadEventStatus = "success" | "error" | "pending" | "warning";

export type LeadEventRecord = {
  id: string;
  lead_id: string | null;
  tenant_id: string;
  event_name: string;
  event_status: LeadEventStatus;
  correlation_id?: string | null;
  idempotency_key?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type LeadApiError = {
  message: string;
  code?: string | null;
  status?: number;
};
