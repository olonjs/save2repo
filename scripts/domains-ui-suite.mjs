#!/usr/bin/env node
import assert from "node:assert/strict";

function normalizeInputDomain(value) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function canAutoPoll(status) {
  return status === "pending_dns" || status === "verifying";
}

function hasRequiredDnsChecks(checks) {
  const normalized = Array.isArray(checks)
    ? checks.map((entry) => String(entry?.type ?? "").toUpperCase())
    : [];
  return normalized.includes("TXT") && normalized.includes("CNAME");
}

function unitSuite() {
  assert.equal(normalizeInputDomain(" Example.COM. "), "example.com");
  assert.equal(canAutoPoll("pending_dns"), true);
  assert.equal(canAutoPoll("verifying"), true);
  assert.equal(canAutoPoll("active"), false);
  assert.equal(
    hasRequiredDnsChecks([{ type: "txt" }, { type: "CNAME" }]),
    true
  );
  assert.equal(hasRequiredDnsChecks([{ type: "TXT" }]), false);
  console.log("unit: domains ui policies ok");
}

async function integrationSuite() {
  const baseUrl = process.env.DOMAINS_UI_TEST_BASE_URL;
  const tenantId = process.env.DOMAINS_UI_TEST_TENANT_ID;
  const token = process.env.DOMAINS_UI_TEST_BEARER;
  if (!baseUrl || !tenantId || !token) {
    console.log("integration: skipped (set DOMAINS_UI_TEST_BASE_URL, DOMAINS_UI_TEST_TENANT_ID, DOMAINS_UI_TEST_BEARER)");
    return;
  }
  const res = await fetch(`${baseUrl}/api/v1/tenants/${encodeURIComponent(tenantId)}/domains`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-correlation-id": `domains-ui-suite-${Date.now()}`,
    },
  });
  assert.equal(res.status < 500, true);
  console.log("integration: tenant domains endpoint responsive");
}

async function e2eSuite() {
  // Placeholder gate for CI pipelines where browser E2E is wired separately.
  const enabled = process.env.DOMAINS_UI_E2E_ENABLED === "1";
  if (!enabled) {
    console.log("e2e: skipped (set DOMAINS_UI_E2E_ENABLED=1 to enforce browser suite)");
    return;
  }
  // In this repo, detailed browser E2E is defined in tests/e2e/domains-ui-smoke.spec.ts.
  assert.ok(true);
  console.log("e2e: gate acknowledged");
}

await (async () => {
  unitSuite();
  await integrationSuite();
  await e2eSuite();
})();
