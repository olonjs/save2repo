#!/usr/bin/env node
import assert from "node:assert/strict";
import { deriveDomainStatusFromVercel } from "../src/lib/domainStatus.js";

function runCase(name, payload, checksCount, expected) {
  const actual = deriveDomainStatusFromVercel(payload, checksCount).status;
  assert.equal(actual, expected, `${name}: expected ${expected}, got ${actual}`);
}

function unitSuite() {
  runCase(
    "provider conflict has highest priority",
    {
      verified: true,
      config: { misconfigured: false, configuredBy: "A", conflicts: [{ domain: "example.com" }] },
    },
    0,
    "conflict"
  );

  runCase(
    "active only when verified true and misconfigured false",
    {
      verified: true,
      config: { misconfigured: false, configuredBy: "A", conflicts: [] },
    },
    0,
    "active"
  );

  runCase(
    "verified true but misconfigured true remains pending_dns",
    {
      verified: true,
      config: { misconfigured: true, configuredBy: null, conflicts: [] },
    },
    0,
    "pending_dns"
  );

  runCase(
    "configuredBy null is pending_dns",
    {
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.example.com", value: "token" }],
      config: { misconfigured: false, configuredBy: null, conflicts: [] },
    },
    1,
    "pending_dns"
  );

  runCase(
    "verification challenge keeps verifying",
    {
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.example.com", value: "token" }],
      config: { misconfigured: false, configuredBy: "CNAME", conflicts: [] },
    },
    0,
    "verifying"
  );

  runCase(
    "checks count keeps verifying",
    {
      verified: false,
      verification: [],
      config: { misconfigured: false, configuredBy: "A", conflicts: [] },
    },
    2,
    "verifying"
  );

  runCase(
    "unknown/incomplete payload never escalates to active",
    {
      verified: true,
      verification: [],
      config: { conflicts: [] },
    },
    0,
    "verifying"
  );

  const onlyActiveWhenCertain = [
    { verified: true, config: { misconfigured: true, configuredBy: "A", conflicts: [] }, checks: 0 },
    { verified: true, config: { misconfigured: null, configuredBy: "A", conflicts: [] }, checks: 0 },
    { verified: false, config: { misconfigured: false, configuredBy: "A", conflicts: [] }, checks: 0 },
    { verified: undefined, config: { misconfigured: false, configuredBy: "A", conflicts: [] }, checks: 0 },
  ];
  for (const item of onlyActiveWhenCertain) {
    const status = deriveDomainStatusFromVercel(
      { verified: item.verified, config: item.config, verification: [] },
      item.checks
    ).status;
    assert.notEqual(status, "active", "active must require verified=true and misconfigured=false");
  }

  console.log("unit: domain status SOT contract ok");
}

unitSuite();
