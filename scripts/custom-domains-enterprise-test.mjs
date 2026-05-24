#!/usr/bin/env node
import assert from 'node:assert/strict';

function normalizeDomain(input) {
  const trimmed = input.trim().toLowerCase();
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

function isValidDomainFormat(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized.length > 253) return false;
  if (normalized.includes('://') || normalized.includes('/')) return false;
  const candidate = normalized.replace(/^\*\./, '');
  const labelRegex = /^[a-z0-9-]{1,63}$/;
  const labels = candidate.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!labelRegex.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
}

function normalizeChecks(checks) {
  const seen = new Set();
  const rows = [];
  for (const item of checks) {
    const type = String(item?.type ?? "").trim().toUpperCase();
    const host = String(item?.domain ?? "").trim().toLowerCase();
    const value = String(item?.value ?? "").trim().toLowerCase();
    if (!type && !host && !value) continue;
    const key = `${type}|${host}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ type, domain: host, value });
  }
  return rows;
}

function unitTests() {
  assert.equal(normalizeDomain('Example.COM.'), 'example.com');
  assert.equal(isValidDomainFormat('example.com'), true);
  assert.equal(isValidDomainFormat('sub.example.com'), true);
  assert.equal(isValidDomainFormat('bad_domain.com'), false);
  assert.equal(isValidDomainFormat('https://example.com'), false);
  const normalizedChecks = normalizeChecks([
    { type: "a", domain: "Example.com", value: "76.76.21.21" },
    { type: "A", domain: "example.com", value: "76.76.21.21" },
    { type: "CNAME", domain: "example.com", value: "cname.vercel-dns.com" },
  ]);
  assert.equal(normalizedChecks.length, 2);
  assert.equal(normalizedChecks.some((row) => row.type === "A"), true);
  assert.equal(normalizedChecks.some((row) => row.type === "CNAME"), true);
  console.log('unit: ok');
}

async function apiCall(baseUrl, token, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function integrationAndE2E() {
  const baseUrl = process.env.CUSTOM_DOMAINS_TEST_BASE_URL;
  const token = process.env.CUSTOM_DOMAINS_TEST_BEARER;
  const tenantId = process.env.CUSTOM_DOMAINS_TEST_TENANT_ID;
  const domain = process.env.CUSTOM_DOMAINS_TEST_DOMAIN;

  if (!baseUrl || !token || !tenantId || !domain) {
    console.log(
      'integration/e2e: skipped (set CUSTOM_DOMAINS_TEST_BASE_URL, CUSTOM_DOMAINS_TEST_BEARER, CUSTOM_DOMAINS_TEST_TENANT_ID, CUSTOM_DOMAINS_TEST_DOMAIN)'
    );
    return;
  }

  const idemKey = `test-${Date.now()}`;
  const addPath = `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains`;
  const statusPath = `${addPath}/${encodeURIComponent(domain)}`;
  const verifyPath = `${statusPath}/verify`;

  const addFirst = await apiCall(baseUrl, token, addPath, {
    method: 'POST',
    headers: { 'idempotency-key': idemKey },
    body: JSON.stringify({ domain }),
  });
  assert.equal([201, 409].includes(addFirst.response.status), true);

  const addReplay = await apiCall(baseUrl, token, addPath, {
    method: 'POST',
    headers: { 'idempotency-key': idemKey },
    body: JSON.stringify({ domain }),
  });
  assert.equal([200, 201, 409].includes(addReplay.response.status), true);

  const status = await apiCall(baseUrl, token, statusPath, { method: 'GET' });
  assert.equal(status.response.status < 500, true);

  const verify = await apiCall(baseUrl, token, verifyPath, { method: 'POST' });
  assert.equal(verify.response.status < 500, true);

  const remove = await apiCall(baseUrl, token, statusPath, {
    method: 'DELETE',
    headers: { 'idempotency-key': idemKey },
  });
  assert.equal(remove.response.status < 500, true);

  console.log('integration/e2e: ok');
}

await (async () => {
  unitTests();
  await integrationAndE2E();
})();
