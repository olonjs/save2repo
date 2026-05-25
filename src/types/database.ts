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
