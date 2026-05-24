-- Migration: add columns and status for Create-from-Template saga (GitHub + Vercel + Supabase)
-- Run in Supabase SQL Editor or via Supabase CLI.

-- Add columns to tenants if not present (idempotent)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS github_repo_id bigint,
  ADD COLUMN IF NOT EXISTS vercel_project_id text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Backfill status for existing rows
UPDATE tenants SET status = 'active' WHERE status IS NULL;

-- Optional: constraint for status enum
-- ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
-- ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('provisioning', 'active', 'failed', 'suspended'));

-- Comment for documentation
COMMENT ON COLUMN tenants.github_repo_id IS 'GitHub repository ID from create-from-template';
COMMENT ON COLUMN tenants.vercel_project_id IS 'Vercel project ID (Team Pro)';
COMMENT ON COLUMN tenants.status IS 'provisioning | active | failed | suspended';
