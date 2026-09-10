import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  buildProbeReport,
  parseProbeArgs,
  validateProbeRequest,
} from "./rc03-receipt-probe.mjs";

test("receipt probe rejects missing authorization and shared-state prerequisites", () => {
  const parsed = parseProbeArgs(["--provider", "anthropic", "--model", "claude", "--message", "hello"]);
  const errors = validateProbeRequest(parsed.options, {}, os.tmpdir());
  assert.ok(errors.some((error) => error.includes("credential")));
  assert.ok(errors.some((error) => error.includes("allow-network")));
  assert.ok(errors.some((error) => error.includes("confirm-non-sensitive")));
});

test("receipt probe rejects a non-temporary state directory", () => {
  const parsed = parseProbeArgs([
    "--provider", "anthropic", "--model", "claude", "--credential-env", "ANTHROPIC_API_KEY",
    "--message", "hello", "--allow-network", "--confirm-non-sensitive", "--state-dir", path.parse(process.cwd()).root,
  ]);
  const errors = validateProbeRequest(parsed.options, { ANTHROPIC_API_KEY: "present" }, os.tmpdir());
  assert.ok(errors.some((error) => error.includes("temporary")));
});

test("receipt report never upgrades absent receipts to real evidence", () => {
  const report = buildProbeReport({
    options: { provider: "anthropic", model: "claude", allowNetwork: true, confirmNonSensitive: true },
    childStatus: 0,
    receipts: { total: 0, byKind: {}, databasePath: null },
  });
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.phase, "NOT_EXECUTED");
  assert.equal(report.evidenceClass, "none");
});
