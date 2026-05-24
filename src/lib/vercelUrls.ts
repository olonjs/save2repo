/**
 * Helpers to derive canonical Vercel URLs.
 *
 * Terminology:
 * - Deployment URL: per-deployment immutable URL with hash.
 *   Example: https://santamamma-i7zq3h4n0-jsonpages.vercel.app
 * - Public URL: stable alias that always points to the latest production deployment.
 *   Example: https://santamamma.vercel.app
 *
 * Persisted as tenants.vercel_url and tenants.vercel_public_url respectively.
 */

/**
 * Build the canonical public URL of a Vercel project from its project name
 * (as returned by the Vercel Projects API). Returns null if the name is empty.
 */
export function derivePublicVercelUrl(projectName: string | null | undefined): string | null {
  if (typeof projectName !== "string") return null;
  const trimmed = projectName.trim();
  if (!trimmed) return null;
  return `https://${trimmed}.vercel.app`;
}
