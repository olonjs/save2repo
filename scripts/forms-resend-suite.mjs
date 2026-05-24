import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

function mapResendDeliveryStatus(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (normalized === "email.sent") return "sent";
  if (normalized === "email.delivered") return "delivered";
  if (normalized === "email.bounced") return "error";
  if (normalized === "email.complaint") return "warning";
  return null;
}

function verifyResendWebhookSignature({ secret, svixId, svixTimestamp, svixSignature, rawBody }) {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;
  const digest = createHmac("sha256", secret).update(`${svixId}.${svixTimestamp}.${rawBody}`).digest("base64");
  const candidates = String(svixSignature)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.startsWith("v1,"))
    .map((token) => token.slice(3));
  return candidates.some((candidate) => candidate === digest);
}

function shouldUseGitStorage({ formsGitStorageEnabled, repoPrivate }) {
  if (!formsGitStorageEnabled) return false;
  return repoPrivate === true;
}

function unitSuite() {
  assert.equal(mapResendDeliveryStatus("email.sent"), "sent");
  assert.equal(mapResendDeliveryStatus("email.delivered"), "delivered");
  assert.equal(mapResendDeliveryStatus("email.bounced"), "error");
  assert.equal(mapResendDeliveryStatus("email.complaint"), "warning");
  assert.equal(mapResendDeliveryStatus("unknown"), null);

  const secret = "whsec_test";
  const svixId = randomUUID();
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "abc123" } });
  const digest = createHmac("sha256", secret).update(`${svixId}.${svixTimestamp}.${rawBody}`).digest("base64");
  assert.equal(
    verifyResendWebhookSignature({
      secret,
      svixId,
      svixTimestamp,
      svixSignature: `v1,${digest}`,
      rawBody,
    }),
    true
  );
  assert.equal(
    verifyResendWebhookSignature({
      secret,
      svixId,
      svixTimestamp,
      svixSignature: "v1,invalid",
      rawBody,
    }),
    false
  );

  assert.equal(shouldUseGitStorage({ formsGitStorageEnabled: true, repoPrivate: true }), true);
  assert.equal(shouldUseGitStorage({ formsGitStorageEnabled: true, repoPrivate: false }), false);
  assert.equal(shouldUseGitStorage({ formsGitStorageEnabled: false, repoPrivate: true }), false);
  console.log("unit: forms resend policies ok");
}

unitSuite();
