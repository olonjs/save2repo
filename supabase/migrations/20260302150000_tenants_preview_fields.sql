-- Migration: add tenant preview metadata fields for dashboard cards
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS preview_image_url text,
  ADD COLUMN IF NOT EXISTS preview_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS preview_status text DEFAULT 'pending';

COMMENT ON COLUMN public.tenants.preview_status IS 'pending | ready | failed';
