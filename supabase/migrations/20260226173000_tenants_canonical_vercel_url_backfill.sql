-- Migration: normalize tenants.vercel_url to canonical project alias URL
-- Convert deployment-specific URLs like:
--   https://<slug>-<hash>-<team>.vercel.app
-- into:
--   https://<slug>.vercel.app
UPDATE tenants
SET vercel_url = CONCAT('https://', slug, '.vercel.app')
WHERE slug IS NOT NULL
  AND vercel_url IS NOT NULL
  AND vercel_url LIKE CONCAT('https://', slug, '-%.vercel.app');
