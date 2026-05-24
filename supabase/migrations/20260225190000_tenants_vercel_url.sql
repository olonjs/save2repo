-- Migration: persist canonical Vercel URL on tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vercel_url text;

-- Backfill best-effort for existing rows (legacy behavior)
UPDATE tenants
SET vercel_url = CONCAT('https://', slug, '.vercel.app')
WHERE vercel_url IS NULL
  AND slug IS NOT NULL;
