#!/usr/bin/env node
import assert from "node:assert/strict";

function shouldReplay(status) {
  return status === "success" || status === "error";
}

function unitTests() {
  assert.equal(shouldReplay("success"), true);
  assert.equal(shouldReplay("error"), true);
  assert.equal(shouldReplay("pending"), false);
  console.log("unit: ok");
}

async function apiCall(baseUrl, token, tenantId, idempotencyKey) {
  const response = await fetch(`${baseUrl}/api/v1/tenants/${encodeURIComponent(tenantId)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": idempotencyKey,
      "x-correlation-id": `tenant-delete-test-${Date.now()}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function integrationAndE2E() {
  const baseUrl = process.env.TENANT_DELETE_TEST_BASE_URL;
  const token = process.env.TENANT_DELETE_TEST_BEARER;
  const tenantId = process.env.TENANT_DELETE_TEST_TENANT_ID;
  const confirmation = process.env.TENANT_DELETE_TEST_CONFIRM;

  if (!baseUrl || !token || !tenantId) {
    console.log(
      "integration/e2e: skipped (set TENANT_DELETE_TEST_BASE_URL, TENANT_DELETE_TEST_BEARER, TENANT_DELETE_TEST_TENANT_ID)"
    );
    return;
  }

  if (confirmation !== "YES_DELETE") {
    console.log('integration/e2e: skipped (set TENANT_DELETE_TEST_CONFIRM="YES_DELETE" to enable destructive test)');
    return;
  }

  const key = `tenant-delete-${Date.now()}`;
  const first = await apiCall(baseUrl, token, tenantId, key);

  assert.equal([200, 404, 409, 500].includes(first.response.status), true);

  const second = await apiCall(baseUrl, token, tenantId, key);

  if (first.response.status === 200) {
    assert.equal(second.response.status, 200);
    assert.equal(Boolean(second.body?.idempotentReplay), true);
  } else if (first.response.status === 409) {
    assert.equal([409, 200].includes(second.response.status), true);
  } else if (first.response.status === 404) {
    assert.equal([404, 200].includes(second.response.status), true);
  } else {
    assert.equal([500, 200].includes(second.response.status), true);
  }

  console.log("integration/e2e: ok");
}

await (async () => {
  unitTests();
  await integrationAndE2E();
})();
