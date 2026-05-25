// Auto-generated from save2repo Supabase schema (project rksmblpvrafygdtnvjzt)
// via Supabase `generate_typescript_types`. DB is the source of truth — UI types
// derive from this file. To refresh after a migration, regenerate and replace.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      lead_dlq: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_attempt_at: string
          last_error_code: string | null
          last_error_message: string | null
          lead_id: string | null
          next_retry_at: string | null
          operation: string
          payload: Json
          resolved_at: string | null
          tenant_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lead_id?: string | null
          next_retry_at?: string | null
          operation: string
          payload?: Json
          resolved_at?: string | null
          tenant_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lead_id?: string | null
          next_retry_at?: string | null
          operation?: string
          payload?: Json
          resolved_at?: string | null
          tenant_id?: string
        }
      }
      lead_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          event_name: string
          event_status: string
          id: string
          idempotency_key: string | null
          lead_id: string | null
          payload: Json
          tenant_id: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          event_name: string
          event_status?: string
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          payload?: Json
          tenant_id: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          event_name?: string
          event_status?: string
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          payload?: Json
          tenant_id?: string
        }
      }
      lead_webhook_events: {
        Row: {
          delivery_status: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          received_at: string
          resend_id: string | null
          webhook_event_key: string
        }
        Insert: {
          delivery_status?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          resend_id?: string | null
          webhook_event_key: string
        }
        Update: {
          delivery_status?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          resend_id?: string | null
          webhook_event_key?: string
        }
      }
      leads: {
        Row: {
          correlation_id: string | null
          created_at: string
          data: Json
          delivery_status: string
          github_commit_sha: string | null
          github_path: string | null
          id: string
          idempotency_key: string | null
          last_error_code: string | null
          last_error_message: string | null
          resend_id: string | null
          source_ip: unknown
          storage_mode: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          data?: Json
          delivery_status?: string
          github_commit_sha?: string | null
          github_path?: string | null
          id?: string
          idempotency_key?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          resend_id?: string | null
          source_ip?: unknown
          storage_mode?: string
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          data?: Json
          delivery_status?: string
          github_commit_sha?: string | null
          github_path?: string | null
          id?: string
          idempotency_key?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          resend_id?: string | null
          source_ip?: unknown
          storage_mode?: string
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
      }
      owner_integrations: {
        Row: {
          github_account_login: string | null
          github_account_type: string | null
          github_installation_id: number | null
          id: string
          owner_user_id: string
          updated_at: string
          vercel_oauth_token: string | null
          vercel_team_id: string | null
          vercel_team_slug: string | null
        }
        Insert: {
          github_account_login?: string | null
          github_account_type?: string | null
          github_installation_id?: number | null
          id?: string
          owner_user_id: string
          updated_at?: string
          vercel_oauth_token?: string | null
          vercel_team_id?: string | null
          vercel_team_slug?: string | null
        }
        Update: {
          github_account_login?: string | null
          github_account_type?: string | null
          github_installation_id?: number | null
          id?: string
          owner_user_id?: string
          updated_at?: string
          vercel_oauth_token?: string | null
          vercel_team_id?: string | null
          vercel_team_slug?: string | null
        }
      }
      tenant_agent_credentials: {
        Row: {
          client_id: string
          client_secret_hash: string
          created_at: string
          display_name: string | null
          id: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
        }
        Insert: {
          client_id: string
          client_secret_hash: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
        }
        Update: {
          client_id?: string
          client_secret_hash?: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
        }
      }
      tenant_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          status: string
          tenant_id: string
          updated_at: string
          verification_payload: Json | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_payload?: Json | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_payload?: Json | null
          verified?: boolean
        }
      }
      tenants: {
        Row: {
          admin_private_key: string | null
          admin_public_key: string | null
          correlation_id: string | null
          created_at: string
          deployment_target: string
          display_name: string | null
          github_owner_login: string | null
          github_repo_id: number | null
          github_repo_name: string | null
          id: string
          owner_user_id: string
          public_form_key: string | null
          slug: string
          status: string
          template_repo: string | null
          updated_at: string
          vercel_project_id: string | null
          vercel_public_url: string | null
          vercel_url: string | null
        }
        Insert: {
          admin_private_key?: string | null
          admin_public_key?: string | null
          correlation_id?: string | null
          created_at?: string
          deployment_target?: string
          display_name?: string | null
          github_owner_login?: string | null
          github_repo_id?: number | null
          github_repo_name?: string | null
          id?: string
          owner_user_id: string
          public_form_key?: string | null
          slug: string
          status?: string
          template_repo?: string | null
          updated_at?: string
          vercel_project_id?: string | null
          vercel_public_url?: string | null
          vercel_url?: string | null
        }
        Update: {
          admin_private_key?: string | null
          admin_public_key?: string | null
          correlation_id?: string | null
          created_at?: string
          deployment_target?: string
          display_name?: string | null
          github_owner_login?: string | null
          github_repo_id?: number | null
          github_repo_name?: string | null
          id?: string
          owner_user_id?: string
          public_form_key?: string | null
          slug?: string
          status?: string
          template_repo?: string | null
          updated_at?: string
          vercel_project_id?: string | null
          vercel_public_url?: string | null
          vercel_url?: string | null
        }
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          github_login: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          github_login?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          github_login?: string | null
          id?: string
          updated_at?: string
        }
      }
    }
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TenantRow = Tables<"tenants">
export type OwnerIntegrationsRow = Tables<"owner_integrations">
export type TenantAgentCredentialRow = Tables<"tenant_agent_credentials">
export type TenantDomainRow = Tables<"tenant_domains">
export type UserRow = Tables<"users">
export type LeadRow = Tables<"leads">
export type LeadEventRow = Tables<"lead_events">
