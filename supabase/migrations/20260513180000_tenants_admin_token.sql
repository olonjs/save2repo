-- Add admin_token column to tenants table.
-- Stores the pre-shared key used by jsonpages-platform to authenticate
-- access to the tenant's /admin route via Vercel Edge Middleware.
-- Nullable: tenants without a configured token cannot open admin from the platform.
ALTER TABLE tenants ADD COLUMN admin_token text;
