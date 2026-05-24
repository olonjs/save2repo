import { parse } from "tldts";

export type ParsedDomain = {
  fqdn: string;
  apex: string;
  isSubdomain: boolean;
};

/**
 * Parse a domain string into its FQDN and registrable apex using the Public
 * Suffix List (via tldts). Used to decide whether a tenant domain should be
 * bootstrapped as a Cloudflare zone (apex) or attached as a subdomain to an
 * existing parent zone in the account.
 *
 * Examples:
 *   parseDomain("olon.it")          -> { apex: "olon.it",   isSubdomain: false }
 *   parseDomain("radice.olon.it")   -> { apex: "olon.it",   isSubdomain: true  }
 *   parseDomain("bbc.co.uk")        -> { apex: "bbc.co.uk", isSubdomain: false }
 *   parseDomain("a.b.olon.it")      -> { apex: "olon.it",   isSubdomain: true  }
 */
export function parseDomain(input: string): ParsedDomain {
  const fqdn = input.trim().toLowerCase().replace(/\.$/, "");
  const result = parse(fqdn);
  const apex = result.domain ?? fqdn;
  return { fqdn, apex, isSubdomain: apex !== fqdn };
}

/**
 * Returns true when the record name belongs to the tenant domain's scope:
 * either equal to the tenant FQDN or a child label of it.
 *
 * Example: tenantFqdn = "radice.olon.it"
 *   "radice.olon.it"      -> true   (the apex of the scope)
 *   "www.radice.olon.it"  -> true   (child)
 *   "other.olon.it"       -> false
 *   "olon.it"             -> false
 */
export function isInDomainScope(recordName: string, tenantFqdn: string): boolean {
  const name = recordName.trim().toLowerCase().replace(/\.$/, "");
  const fqdn = tenantFqdn.trim().toLowerCase().replace(/\.$/, "");
  if (!name || !fqdn) return false;
  if (name === fqdn) return true;
  return name.endsWith("." + fqdn);
}
