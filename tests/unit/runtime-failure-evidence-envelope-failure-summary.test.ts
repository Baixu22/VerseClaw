import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY,
  RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_DIAGNOSTICS_ONLY,
  RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_KIND,
  classifyRuntimeFailurePassiveShadow,
  createFailureSummaryEvidenceEnvelope,
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
  type FailureEvent,
  type FailureSummaryEvidenceEnvelopeInput,
  type RuntimeFailureEvidenceReplayValidationResult,
} from "../../openclaw_runtime/src/runtime-core";

const NOW_MS = Date.parse("2026-07-01T12:00:00.000Z");

function validFailureEvent(overrides: Partial<FailureEvent> = {}): FailureEvent {
  return {
    ...classifyRuntimeFailurePassiveShadow({
      id: "failure-1",
      runId: "run-1",
      source: "runtime-failure-evidence-envelope-failure-summary-test",
      occurredAt: "2026-07-01T11:59:30.000Z",
      signal: {
        stage: "tool_call",
        kind: "timeout",
        message: "Tool call exceeded the fixture timeout.",
        timedOut: true,
      },
      evidenceRefs: ["tool-run-1"],
    }),
    ...overrides,
  };
}

function validEnvelopeInput(
  overrides: Partial<FailureSummaryEvidenceEnvelopeInput> = {},
): FailureSummaryEvidenceEnvelopeInput {
  return {
    failureEvent: validFailureEvent(),
    source: { component: "runtime-core-failure-summary-test", runId: "run-1" },
    scope: { workspace: "fixture-workspace", runId: "run-1", paths: ["src/example.ts"] },
    createdAt: "2026-07-01T11:59:45.000Z",
    ttlMs: 120_000,
    provenance: {
      producer: "runtime-failure-evidence-envelope-failure-summary-test",
      version: "0",
      inputs: ["failure-1"],
    },
    nowMs: NOW_MS,
    ...overrides,
  };
}

function expectEnvelope(
  result: RuntimeFailureEvidenceReplayValidationResult<EvidenceEnvelope>,
): EvidenceEnvelope {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  expect(validateEvidenceEnvelope(result.value, { nowMs: NOW_MS }).ok).toBe(true);
  return result.value;
}

function errorCodes(result: RuntimeFailureEvidenceReplayValidationResult<EvidenceEnvelope>): string[] {
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("runtime failure evidence envelope failure summary adapter", () => {
  it("accepts a valid passive FailureEvent and emits a valid diagnostics-only EvidenceEnvelope", () => {
    const envelope = expectEnvelope(createFailureSummaryEvidenceEnvelope(validEnvelopeInput()));

    expect(RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_DIAGNOSTICS_ONLY).toBe(true);
    expect(envelope).toMatchObject({
      kind: RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_KIND,
      authority: RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY,
      rawRetained: false,
      redaction: { state: "sanitized", rawRetained: false, secretScan: "pass" },
      confidence: envelope.payload && typeof envelope.payload === "object"
        ? (envelope.payload as { classification?: { confidence?: number } }).classification?.confidence
        : undefined,
    });
    expect(JSON.stringify(envelope.payload)).toContain("\"stage\":\"tool_call\"");
    expect(JSON.stringify(envelope.payload)).toContain("\"kind\":\"timeout\"");
  });

  it("rejects an invalid FailureEvent", () => {
    const invalidFailureEvent = {
      ...validFailureEvent(),
      stage: "provider_retry",
    } as unknown as FailureEvent;

    const result = createFailureSummaryEvidenceEnvelope(validEnvelopeInput({
      failureEvent: invalidFailureEvent,
    }));

    expect(errorCodes(result)).toContain("invalid_enum");
  });

  it("rejects raw retention attempts", () => {
    const result = createFailureSummaryEvidenceEnvelope({
      ...validEnvelopeInput(),
      rawRetained: true,
    });

    expect(errorCodes(result)).toContain("raw_retained");
  });

  it("rejects authority above none", () => {
    const result = createFailureSummaryEvidenceEnvelope({
      ...validEnvelopeInput(),
      authority: "runtime",
    });

    expect(errorCodes(result)).toContain("invalid_authority");
  });

  it("rejects missing source, scope, provenance, and TTL metadata", () => {
    const cases: Array<[string, Partial<FailureSummaryEvidenceEnvelopeInput>, string]> = [
      ["source", { source: undefined as never }, "missing_required"],
      ["scope", { scope: undefined as never }, "missing_required"],
      ["provenance", { provenance: undefined as never }, "missing_required"],
      ["ttl", { ttlMs: undefined as never }, "invalid_ttl"],
    ];

    for (const [, overrides, expectedCode] of cases) {
      expect(errorCodes(createFailureSummaryEvidenceEnvelope(validEnvelopeInput(overrides)))).toContain(expectedCode);
    }
  });

  it("rejects expired TTL", () => {
    const result = createFailureSummaryEvidenceEnvelope(validEnvelopeInput({
      createdAt: "2026-07-01T11:00:00.000Z",
      ttlMs: 1_000,
    }));

    expect(errorCodes(result)).toContain("expired");
  });

  it("rejects payloads that exceed the configured envelope budget", () => {
    const result = createFailureSummaryEvidenceEnvelope(validEnvelopeInput({
      maxPayloadBytes: 24,
    }));

    expect(errorCodes(result)).toContain("payload_oversized");
  });

  it("does not let secret-like raw content survive the payload", () => {
    const failureEvent = validFailureEvent({
      summary: [
        "Provider payload failed with api_key=sk-thisShouldNotSurvive1234567890",
        "PASSWORD=hunter2",
        "workspace C:\\Users\\someone\\project\\private-file.ts",
        "{\"prompt\":\"raw user prompt\",\"toolArgs\":{\"secret\":\"tool secret\"}}",
      ].join(" "),
      evidenceRefs: [
        "providerPayload={\"messages\":[\"raw prompt\"]}",
        "toolArgs={\"secret\":\"abc\"}",
      ],
    });

    const envelope = expectEnvelope(createFailureSummaryEvidenceEnvelope(validEnvelopeInput({ failureEvent })));
    const payload = JSON.stringify(envelope.payload);

    expect(payload).not.toContain("sk-thisShouldNotSurvive");
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain("private-file.ts");
    expect(payload).not.toContain("raw user prompt");
    expect(payload).not.toContain("tool secret");
    expect(payload).toContain("[redacted");
  });

  it("does not introduce an active runtime consumer", () => {
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-evidence-envelope-summary",
      "createFailureSummaryEvidenceEnvelope",
    ]));

    expect(hits).toEqual([]);
  });

  it("does not introduce checkpoint or lifecycle authority writes", () => {
    const authorityFiles = [
      "openclaw_runtime/src/runtime-core/checkpoint-serializer.ts",
      "openclaw_runtime/src/gateway/session-compaction-checkpoints.ts",
      "openclaw_runtime/src/acp/persistent-bindings.lifecycle.ts",
    ];
    const hits = authorityFiles.flatMap((file) => sourceFileHits(file, [
      "failure-evidence-envelope-summary",
      "createFailureSummaryEvidenceEnvelope",
    ]));

    expect(hits).toEqual([]);
  });
});

function sourceHits(root: string, needles: string[]): string[] {
  const absoluteRoot = join(process.cwd(), root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  return collectSourceFiles(absoluteRoot).flatMap((file) => sourceFileHits(file, needles));
}

function sourceFileHits(file: string, needles: string[]): string[] {
  const absoluteFile = isAbsolute(file) ? file : join(process.cwd(), file);
  if (!existsSync(absoluteFile)) {
    return [];
  }
  const content = readFileSync(absoluteFile, "utf8");
  return needles.some((needle) => content.includes(needle))
    ? [absoluteFile.replace(process.cwd(), "").replace(/^[\\/]/, "")]
    : [];
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) {
        return [];
      }
      return collectSourceFiles(child);
    }
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [child] : [];
  });
}
