#!/usr/bin/env node
// Cloudflare DNS domains end-to-end integration test.
// Env-gated; skips silently when required vars are missing.
//
// Required env:
//   TENANT_DELETE_TEST_BASE_URL   base URL of the running platform
//   TENANT_DELETE_TEST_BEARER     bearer token of a tenant editor user
//   TENANT_DELETE_TEST_TENANT_ID  tenant id
//   CF_TEST_DOMAIN                domain to add/bootstrap (e.g. cf-test-123.example.com)
//
// Optional env:
//   CF_TEST_CONFIRM=YES_RUN        actually run destructive bootstrap on Cloudflare
//   CF_TEST_POLL_TIMEOUT_MS=600000 max time to wait for cf_status=active (default 10m)

import assert from "node:assert/strict";

const baseUrl = process.env.TENANT_DELETE_TEST_BASE_URL;
const bearer = process.env.TENANT_DELETE_TEST_BEARER;
const tenantId = process.env.TENANT_DELETE_TEST_TENANT_ID;
const domain = process.env.CF_TEST_DOMAIN;
const confirmRun = process.env.CF_TEST_CONFIRM === "YES_RUN";
const pollTimeoutMs = Number(process.env.CF_TEST_POLL_TIMEOUT_MS ?? 600_000);

if (!baseUrl || !bearer || !tenantId || !domain) {
  console.log(
    "cf-domains-test: skipped (set TENANT_DELETE_TEST_BASE_URL, TENANT_DELETE_TEST_BEARER, TENANT_DELETE_TEST_TENANT_ID, CF_TEST_DOMAIN)"
  );
  process.exit(0);
}

if (!confirmRun) {
  console.log('cf-domains-test: skipped (set CF_TEST_CONFIRM="YES_RUN" to enable destructive run against Cloudflare)');
  process.exit(0);
}

const headers = (extra = {}) => ({
  authorization: `Bearer ${bearer}`,
  "x-correlation-id": `cf-domains-test-${Date.now()}`,
  ...extra,
});

const endpoint = (path) => `${baseUrl}${path}`;

async function jsonFetch(method, path, init = {}) {
  const res = await fetch(endpoint(path), {
    ...init,
    method,
    headers: { ...headers(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function log(step, info) {
  console.log(`[cf-test] ${step}`, info ?? "");
}

async function ensureDomainAdded() {
  const add = await jsonFetch("POST", `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains`, {
    headers: {
      "content-type": "application/json",
      "idempotency-key": `cf-test-add-${Date.now()}`,
    },
    body: JSON.stringify({ domain }),
  });
  if (add.status === 409) {
    log("domain.exists.reuse", { domain });
    return;
  }
  assert.equal(
    [200, 201].includes(add.status),
    true,
    `expected 200/201 on add domain, got ${add.status}: ${JSON.stringify(add.body)}`
  );
  log("domain.added", { domain });
}

async function bootstrapCf() {
  const res = await jsonFetch(
    "POST",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/cf-bootstrap`,
    {
      headers: { "idempotency-key": `cf-test-bootstrap-${Date.now()}` },
    }
  );
  assert.equal(res.status, 200, `bootstrap failed: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.cf_zone_id, "cf_zone_id missing");
  assert.ok(Array.isArray(res.body.name_servers), "name_servers missing");
  log("cf.bootstrap.ok", { zone: res.body.cf_zone_id, ns: res.body.name_servers });
  return res.body;
}

async function pollUntilActive() {
  const started = Date.now();
  while (Date.now() - started < pollTimeoutMs) {
    const res = await jsonFetch(
      "GET",
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}`
    );
    if (res.status === 200 && res.body?.domain?.cf_status === "active") {
      log("cf.active", { elapsedMs: Date.now() - started });
      return res.body.domain;
    }
    log("cf.pending", { cf_status: res.body?.domain?.cf_status ?? "unknown" });
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`cf_status did not reach 'active' within ${pollTimeoutMs}ms`);
}

async function dnsCrud() {
  const list1 = await jsonFetch(
    "GET",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns`
  );
  assert.equal(list1.status, 200, `dns list failed: ${JSON.stringify(list1.body)}`);
  log("dns.list", { count: list1.body.records?.length ?? 0 });

  const create = await jsonFetch(
    "POST",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns`,
    {
      headers: { "content-type": "application/json", "idempotency-key": `cf-test-create-${Date.now()}` },
      body: JSON.stringify({
        type: "TXT",
        name: `cf-test-${Date.now()}.${domain}`,
        content: "cf-domains-test-marker",
        ttl: 60,
      }),
    }
  );
  assert.equal(create.status, 200, `dns create failed: ${JSON.stringify(create.body)}`);
  const recordId = create.body.record.id;
  log("dns.create", { id: recordId });

  const patch = await jsonFetch(
    "PATCH",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`,
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "cf-domains-test-marker-updated" }),
    }
  );
  assert.equal(patch.status, 200, `dns patch failed: ${JSON.stringify(patch.body)}`);
  log("dns.patch.ok");

  const del = await jsonFetch(
    "DELETE",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`
  );
  assert.equal(del.status, 200, `dns delete failed: ${JSON.stringify(del.body)}`);
  log("dns.delete.ok");
}

async function disconnect() {
  const res = await jsonFetch(
    "POST",
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/cf-disconnect`,
    {
      headers: { "idempotency-key": `cf-test-disconnect-${Date.now()}` },
    }
  );
  assert.equal(res.status, 200, `disconnect failed: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.cf_status, "disconnected");
  assert.equal(res.body.mode, "unlink");
  log("cf.disconnect.ok");
}

async function run() {
  await ensureDomainAdded();
  await bootstrapCf();
  log("hint", "Update registrar nameservers to the values printed above, then this run will wait for active.");
  await pollUntilActive();
  await dnsCrud();
  await disconnect();
  console.log("cf-domains-test: ok");
}

run().catch((err) => {
  console.error("cf-domains-test: FAILED", err);
  process.exit(1);
});
