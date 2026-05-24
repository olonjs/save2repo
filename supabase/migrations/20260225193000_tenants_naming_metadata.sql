-- Migration: store naming resolution metadata for provisioning
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS requested_name text,
  ADD COLUMN IF NOT EXISTS final_project_name text,
  ADD COLUMN IF NOT EXISTS naming_attempts integer;

-- Backfill existing rows with best-effort values
UPDATE tenants
SET requested_name = COALESCE(requested_name, name),
    final_project_name = COALESCE(final_project_name, slug),
    naming_attempts = COALESCE(naming_attempts, 1)
WHERE requested_name IS NULL
   OR final_project_name IS NULL
   OR naming_attempts IS NULL;
