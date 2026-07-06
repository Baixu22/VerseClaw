import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES,
  validateEvidenceEnvelope,
  validateFailureEvent,
  validateReplayCase,
  type EvidenceEnvelope,
  type FailureEvent,
  type ReplayCase,
} from "../../openclaw_runtime/src/runtime-core";

const NOW_MS = Date.parse("2026-07-01T12:00:00.000Z");

function validFailureEvent(overrides: Partial<FailureEvent> = {}): FailureEvent {
  return {
    id: "failure-1",
    stage: "tool_call",
    kind: "timeout",
    recoverability: "retryable",
    suggestedAction: "retry",
    confidence: 0.82,
    source: "runtime-core-schema-spike-test",
    occurredAt: "2026-07-01T11:59:00.000Z",
    summary: "Tool call exceeded the fixture timeout.",
    evidenceRefs: ["evidence-1"],
    rawRetained: false,
    redaction: "sanitized",
    ...overrides,
  };
}

function validEvidenceEnvelope(overrides: Partial<EvidenceEnvelope> = {}): EvidenceEnvelope {
  return {
    id: "evidence-1",
    kind: "failure_summary",
    source: { component: "runtime-core-schema-spike-test", runId: "run-1" },
    scope: { workspace: "fixture-workspace", runId: "run-1", paths: ["src/example.ts"] },
    createdAt: "2026-07-01T11:59:30.000Z",
    ttlMs: 120_000,
    confidence: 0.9,
    redaction: { state: "metadata_only", rawRetained: false, secretScan: "not_run" },
    provenance: { producer: "schema-spike-test", version: "0", inputs: ["failure-1"] },
    authority: "none",
    payload: { summary: "Metadata-only failure summary." },
    ...overrides,
  };
}

function validReplayCase(overrides: Partial<ReplayCase> = {}): ReplayCase {
  return {
    id: "replay-1",
    title: "Tool timeout fixture replay",
    scenario: "tool_error",
    input: {
      userMessage: "Run the fixture-backed task.",
      workspaceFixture: "fixtures/workspaces/tool-timeout",
      providerFixture: "fixtures/providers/tool-timeout.json",
      toolFixture: "fixtures/tools/tool-timeout.json",
    },
    expected: {
      terminalStatus: "failed",
      allowedFailureKinds: ["timeout"],
      disallowedActions: ["rollback_recommended"],
      touchedPaths: [],
    },
    budgets: {
      maxPromptBytes: 4096,
      maxToolCalls: 3,
      maxDurationMs: 30_000,
    },
    ...overrides,
  };
}

function errorCodes(result: { ok: true } | { ok: false; errors: Array<{ code: string }> }): string[] {
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("runtime failure/evidence/replay schema spike validators", () => {
  it("accepts representative schema-only contracts", () => {
    expect(validateFailureEvent(validFailureEvent()).ok).toBe(true);
    expect(validateEvidenceEnvelope(validEvidenceEnvelope(), { nowMs: NOW_MS }).ok).toBe(true);
    expect(validateReplayCase(validReplayCase()).ok).toBe(true);
  });

  it("rejects malformed FailureEvent contracts", () => {
    const missingRequired = { ...validFailureEvent(), id: undefined };
    const invalidEnum = { ...validFailureEvent(), stage: "provider_retry" };
    const malformedTimestamp = { ...validFailureEvent(), occurredAt: "tomorrow" };
    const rawRetained = { ...validFailureEvent(), rawRetained: true };
    const missingRedaction = { ...validFailureEvent(), redaction: undefined };
    const invalidConfidence = { ...validFailureEvent(), confidence: 1.2 };

    expect(errorCodes(validateFailureEvent(missingRequired))).toContain("invalid_type");
    expect(errorCodes(validateFailureEvent(invalidEnum))).toContain("invalid_enum");
    expect(errorCodes(validateFailureEvent(malformedTimestamp))).toContain("malformed_timestamp");
    expect(errorCodes(validateFailureEvent(rawRetained))).toContain("raw_retained");
    expect(errorCodes(validateFailureEvent(missingRedaction))).toContain("invalid_enum");
    expect(errorCodes(validateFailureEvent(invalidConfidence))).toContain("invalid_confidence");
  });

  it("rejects EvidenceEnvelope authority, retention, expiry, metadata, and budget violations", () => {
    const expired = validEvidenceEnvelope({
      createdAt: "2026-07-01T11:00:00.000Z",
      ttlMs: 1_000,
    });
    const wrongAuthority = { ...validEvidenceEnvelope(), authority: "runtime" };
    const rawRetained = validEvidenceEnvelope({
      redaction: { state: "sanitized", rawRetained: true, secretScan: "pass" },
    } as Partial<EvidenceEnvelope>);
    const topLevelRawRetained = { ...validEvidenceEnvelope(), rawRetained: true };
    const missingRedaction = { ...validEvidenceEnvelope(), redaction: undefined };
    const missingProvenance = { ...validEvidenceEnvelope(), provenance: undefined };
    const invalidConfidence = { ...validEvidenceEnvelope(), confidence: -0.01 };
    const invalidTtl = { ...validEvidenceEnvelope(), ttlMs: 0 };
    const malformedTimestamp = { ...validEvidenceEnvelope(), createdAt: "2026-07-01" };
    const oversizedPayload = validEvidenceEnvelope({
      payload: { text: "x".repeat(RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES + 1) },
    });

    expect(errorCodes(validateEvidenceEnvelope(expired, { nowMs: NOW_MS }))).toContain("expired");
    expect(errorCodes(validateEvidenceEnvelope(wrongAuthority, { nowMs: NOW_MS }))).toContain("invalid_authority");
    expect(errorCodes(validateEvidenceEnvelope(rawRetained, { nowMs: NOW_MS }))).toContain("raw_retained");
    expect(errorCodes(validateEvidenceEnvelope(topLevelRawRetained, { nowMs: NOW_MS }))).toContain("raw_retained");
    expect(errorCodes(validateEvidenceEnvelope(missingRedaction, { nowMs: NOW_MS }))).toContain("missing_required");
    expect(errorCodes(validateEvidenceEnvelope(missingProvenance, { nowMs: NOW_MS }))).toContain("missing_required");
    expect(errorCodes(validateEvidenceEnvelope(invalidConfidence, { nowMs: NOW_MS }))).toContain("invalid_confidence");
    expect(errorCodes(validateEvidenceEnvelope(invalidTtl, { nowMs: NOW_MS }))).toContain("invalid_ttl");
    expect(errorCodes(validateEvidenceEnvelope(malformedTimestamp, { nowMs: NOW_MS }))).toContain("malformed_timestamp");
    expect(errorCodes(validateEvidenceEnvelope(oversizedPayload, { nowMs: NOW_MS }))).toContain("payload_oversized");
  });

  it("rejects ReplayCase live-provider defaults, missing fixtures, bad enums, and unbounded budgets", () => {
    const missingProviderFixture = validReplayCase({
      input: { ...validReplayCase().input, providerFixture: "" },
    });
    const missingToolFixture = validReplayCase({
      input: { ...validReplayCase().input, toolFixture: "" },
    });
    const missingWorkspaceFixture = validReplayCase({
      input: { ...validReplayCase().input, workspaceFixture: "" },
    });
    const liveProvider = validReplayCase({
      input: { ...validReplayCase().input, providerFixture: "live" },
    });
    const liveProviderFlag = {
      ...validReplayCase(),
      input: { ...validReplayCase().input, liveProvider: true },
    };
    const invalidScenario = { ...validReplayCase(), scenario: "provider_live" };
    const invalidExpected = validReplayCase({
      expected: { ...validReplayCase().expected, allowedFailureKinds: ["network_flake"] as never },
    });
    const invalidBudget = validReplayCase({
      budgets: { maxToolCalls: 0 },
    });
    const missingBudgetLimits = validReplayCase({
      budgets: {},
    });

    expect(errorCodes(validateReplayCase(missingProviderFixture))).toContain("missing_fixture");
    expect(errorCodes(validateReplayCase(missingToolFixture))).toContain("missing_fixture");
    expect(errorCodes(validateReplayCase(missingWorkspaceFixture))).toContain("missing_fixture");
    expect(errorCodes(validateReplayCase(liveProvider))).toContain("live_provider_default");
    expect(errorCodes(validateReplayCase(liveProviderFlag))).toContain("live_provider_default");
    expect(errorCodes(validateReplayCase(invalidScenario))).toContain("invalid_enum");
    expect(errorCodes(validateReplayCase(invalidExpected))).toContain("invalid_enum");
    expect(errorCodes(validateReplayCase(invalidBudget))).toContain("invalid_budget");
    expect(errorCodes(validateReplayCase(missingBudgetLimits))).toContain("invalid_budget");
  });
});
