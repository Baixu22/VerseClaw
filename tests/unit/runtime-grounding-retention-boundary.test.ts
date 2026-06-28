import { describe, expect, it } from "vitest";
import {
  buildGroundingQueryFixture,
  buildGroundingRefFixture,
  buildGroundingResultFixture,
  evaluateEvidenceVerifier,
  GROUNDING_REF_AUTHORITY,
  GROUNDING_REF_KINDS,
  groundingRefFromEvidenceRef,
  isGroundingQuery,
  isGroundingRef,
  isGroundingResult,
  sanitizeGroundingMetadata,
  sanitizeGroundingQuery,
  sanitizeGroundingRef,
  type GroundingRef,
  type GroundingResult,
} from "../../openclaw_runtime/src/runtime-core";
import * as groundingExports from "../../openclaw_runtime/src/runtime-core/grounding";
import * as runtimeCoreExports from "../../openclaw_runtime/src/runtime-core";

const RAW_SENTINELS = [
  "RAW_PROMPT_SHOULD_NOT_SURVIVE",
  "RAW_CHAT_SHOULD_NOT_SURVIVE",
  "RAW_TRACE_SHOULD_NOT_SURVIVE",
  "FULL_TRACE_SHOULD_NOT_SURVIVE",
  "FULL_PAYLOAD_SHOULD_NOT_SURVIVE",
  "FULL_CHECKPOINT_SHOULD_NOT_SURVIVE",
  "FULL_TOOL_ARGS_SHOULD_NOT_SURVIVE",
  "FULL_TOOL_OUTPUT_SHOULD_NOT_SURVIVE",
  "STDOUT_SHOULD_NOT_SURVIVE",
  "STDERR_SHOULD_NOT_SURVIVE",
  "ENV_SHOULD_NOT_SURVIVE",
  "SECRET_SHOULD_NOT_SURVIVE",
] as const;

const RAW_SMUGGLE_FIELDS = {
  rawPrompt: RAW_SENTINELS[0],
  rawChat: RAW_SENTINELS[1],
  rawTrace: RAW_SENTINELS[2],
  fullTrace: { dump: RAW_SENTINELS[3] },
  fullPayload: { payload: RAW_SENTINELS[4] },
  fullCheckpoint: { checkpoint: RAW_SENTINELS[5] },
  fullToolArgs: { args: RAW_SENTINELS[6] },
  toolArgs: { args: RAW_SENTINELS[6] },
  fullToolOutput: RAW_SENTINELS[7],
  toolOutput: RAW_SENTINELS[7],
  stdout: RAW_SENTINELS[8],
  stderr: RAW_SENTINELS[9],
  env: { OPENCLAW_SECRET: RAW_SENTINELS[10] },
  secrets: { apiKey: RAW_SENTINELS[11] },
  secret: RAW_SENTINELS[11],
};

describe("runtime grounding retention and boundary contracts", () => {
  it("rejects or redacts raw prompt, raw chat, raw trace, and full trace fields", () => {
    const dirtyRef = {
      ...buildGroundingRefFixture({
        summary: "Sanitized trace summary only.",
        sanitization: {
          sanitized: true,
          rawRetained: false,
          redacted: ["prompt", "chat", "trace"],
          rejectedReason: "raw inputs are outside the grounding contract",
        },
      }),
      rawPrompt: RAW_SMUGGLE_FIELDS.rawPrompt,
      rawChat: RAW_SMUGGLE_FIELDS.rawChat,
      rawTrace: RAW_SMUGGLE_FIELDS.rawTrace,
      fullTrace: RAW_SMUGGLE_FIELDS.fullTrace,
    } as unknown as GroundingRef;

    const sanitized = sanitizeGroundingRef(dirtyRef);

    expect(isGroundingRef(sanitized)).toBe(true);
    expect(sanitized.sanitization.rawRetained).toBe(false);
    expect(sanitized.sanitization.redacted).toEqual([
      "prompt",
      "chat",
      "trace",
    ]);
    expect(sanitized.sanitization.rejectedReason).toBe(
      "raw inputs are outside the grounding contract",
    );
    expectNoSentinels(serializedText(sanitized), RAW_SENTINELS.slice(0, 4));
    expect(sanitized).not.toHaveProperty("rawPrompt");
    expect(sanitized).not.toHaveProperty("rawChat");
    expect(sanitized).not.toHaveProperty("rawTrace");
    expect(sanitized).not.toHaveProperty("fullTrace");
  });

  it("keeps full payloads, checkpoints, tool streams, env, and secrets out of refs and results", () => {
    const dirtyRef = {
      ...buildGroundingRefFixture({
        kind: "tool",
        id: "tool_sanitized",
        canonicalKey: "tool:tool_sanitized",
        ref: "tool_sanitized",
        summary: "Tool execution summary without raw streams.",
        metadata: { status: "summarized" },
      }),
      ...RAW_SMUGGLE_FIELDS,
    } as unknown as GroundingRef;

    const sanitizedRef = sanitizeGroundingRef(dirtyRef);
    const result = buildGroundingResultFixture({
      query: buildGroundingQueryFixture({ includeRaw: true } as never),
      refs: [dirtyRef],
      metadata: { retention: "summary_only" },
    });

    expect(isGroundingRef(sanitizedRef)).toBe(true);
    expect(isGroundingResult(result)).toBe(true);
    expect(result.query.includeRaw).toBe(false);
    expectNoSentinels(serializedText(sanitizedRef), RAW_SENTINELS);
    expectNoSentinels(serializedText(result), RAW_SENTINELS);

    for (const key of Object.keys(RAW_SMUGGLE_FIELDS)) {
      expect(sanitizedRef).not.toHaveProperty(key);
      expect(result.refs[0]).not.toHaveProperty(key);
    }
  });

  it("drops raw and secret metadata from refs, queries, results, and projection options", () => {
    const dirtyMetadata = {
      safe: "kept",
      source: "summary only",
      nested: {
        safeNested: "kept",
        rawTrace: RAW_SENTINELS[2],
        toolArgs: { command: RAW_SENTINELS[6] },
        note: `stdout: ${RAW_SENTINELS[8]}`,
      },
      cleanList: ["kept", `stderr: ${RAW_SENTINELS[9]}`],
      rawChat: RAW_SENTINELS[1],
      fullPayload: { value: RAW_SENTINELS[4] },
      fullCheckpoint: { value: RAW_SENTINELS[5] },
      processEnv: RAW_SENTINELS[10],
      secrets: { apiKey: RAW_SENTINELS[11] },
      headers: { authorization: `Bearer ${RAW_SENTINELS[11]}` },
      trace: {
        traceparent: RAW_SENTINELS[2],
        tracestate: RAW_SENTINELS[2],
        baggage: RAW_SENTINELS[2],
      },
    } as GroundingRef["metadata"];

    const sanitizedMetadata = sanitizeGroundingMetadata(dirtyMetadata);
    const ref = buildGroundingRefFixture({ metadata: dirtyMetadata });
    const query = sanitizeGroundingQuery(
      buildGroundingQueryFixture({ metadata: dirtyMetadata }),
    );
    const result = buildGroundingResultFixture({
      query: buildGroundingQueryFixture({ metadata: dirtyMetadata }),
      refs: [ref],
      metadata: dirtyMetadata,
    });
    const projected = groundingRefFromEvidenceRef(
      {
        type: "file",
        ref: "openclaw_runtime/src/runtime-core/grounding.ts",
      },
      {
        sourceSurface: "retention-boundary-test",
        sourceField: "evidenceRefs",
        transform: "projection-options-metadata",
        metadata: dirtyMetadata,
      },
    );

    expect(sanitizedMetadata).toMatchObject({
      safe: "kept",
      source: "summary only",
      nested: { safeNested: "kept" },
      cleanList: ["kept"],
    });

    const output = JSON.stringify({
      sanitizedMetadata,
      ref,
      query,
      result,
      projected,
    });
    expectNoSentinels(output, RAW_SENTINELS);
    expectNoSubstrings(output, [
      "rawChat",
      "rawTrace",
      "toolArgs",
      "fullPayload",
      "fullCheckpoint",
      "stdout",
      "stderr",
      "processEnv",
      "apiKey",
      "authorization",
      "traceparent",
      "tracestate",
      "baggage",
    ]);
    expect(ref.metadata?.safe).toBe("kept");
    expect(query.metadata?.safe).toBe("kept");
    expect(result.metadata?.safe).toBe("kept");
    expect(projected.metadata?.safe).toBe("kept");
  });

  it("normalizes includeRaw true without returning raw data", () => {
    const dirtyQuery = buildGroundingQueryFixture({
      includeRaw: true,
      metadata: {
        diagnostic: "includeRaw was requested but raw data remains unavailable",
      },
    } as never);

    const sanitizedQuery = sanitizeGroundingQuery(dirtyQuery);
    const result = buildGroundingResultFixture({
      query: dirtyQuery,
      refs: [buildGroundingRefFixture({ summary: "Projected summary only." })],
    });

    expect(isGroundingQuery(sanitizedQuery)).toBe(true);
    expect(sanitizedQuery.includeRaw).toBe(false);
    expect(result.query.includeRaw).toBe(false);
    expectNoSentinels(serializedText(result), RAW_SENTINELS);
  });

  it("keeps rawRetained false and authority none for every ref kind and result item", () => {
    const refs = GROUNDING_REF_KINDS.map((kind) =>
      buildGroundingRefFixture({
        kind,
        id: `grounding_${kind}`,
        canonicalKey: `${kind}:boundary`,
        ref: `${kind}:boundary`,
      })
    );
    const result = buildGroundingResultFixture({
      query: buildGroundingQueryFixture({ limit: refs.length }),
      refs,
    });

    expect(refs.every((ref) => ref.rawRetained === false)).toBe(true);
    expect(refs.every((ref) => ref.projection.rawRetained === false)).toBe(true);
    expect(refs.every((ref) => ref.sanitization.rawRetained === false)).toBe(true);
    expect(refs.every((ref) => ref.authority === GROUNDING_REF_AUTHORITY)).toBe(
      true,
    );
    expect(result.items.every((item) => item.authority === "none")).toBe(true);
  });

  it("keeps source refs as anchors that do not satisfy verifier evidence", () => {
    const sourceOnlyRef = buildGroundingRefFixture({
      kind: "source",
      id: "source_anchor_only",
      canonicalKey: "source:openclaw_runtime/src/runtime-core/grounding.ts",
      ref: "openclaw_runtime/src/runtime-core/grounding.ts",
      evidenceRef: undefined,
      sourceRef: {
        file: "openclaw_runtime/src/runtime-core/grounding.ts",
        symbol: "GroundingRef",
      },
      trust: "projected",
      summary: "Source anchor for context selection.",
    });

    const report = evaluateEvidenceVerifier(
      {
        taskId: "task_source_anchor",
        objective: "Source anchors must not count as verifier evidence.",
        obligations: [
          {
            id: "obligation_source_anchor",
            description: "Need verifier-backed file evidence.",
            status: "satisfied",
          },
        ],
        evidenceRefs: [],
        toolResults: [],
        eventReplay: {
          status: "consistent",
          diagnosticCodes: [],
          pendingToolCallIds: [],
          evidenceRefCount: 0,
        },
      },
      { requiredEvidenceKinds: ["file"] },
    );

    expect(isGroundingRef(sourceOnlyRef)).toBe(true);
    expect(sourceOnlyRef.evidenceRef).toBeUndefined();
    expect(sourceOnlyRef.sourceRef).toMatchObject({
      file: "openclaw_runtime/src/runtime-core/grounding.ts",
      symbol: "GroundingRef",
    });
    expect(sourceOnlyRef.authority).toBe("none");
    expect(report.decision).toBe("insufficient_evidence");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "missing_file_evidence",
    );
  });

  it("keeps renderer, external, subagent, and model summaries untrusted or projected", () => {
    const projectedRefs = [
      {
        sourceSurface: "renderer",
        sourceField: "chatIntent",
        trust: "untrusted",
      },
      {
        sourceSurface: "external",
        sourceField: "traceContext",
        trust: "untrusted",
      },
      {
        sourceSurface: "subagent",
        sourceField: "summary",
        trust: "projected",
      },
      {
        sourceSurface: "model",
        sourceField: "summary",
        trust: "projected",
      },
    ] as const;

    const refs = projectedRefs.map((entry) =>
      buildGroundingRefFixture({
        id: `grounding_${entry.sourceSurface}`,
        canonicalKey: `${entry.sourceSurface}:${entry.sourceField}`,
        ref: `${entry.sourceSurface}:${entry.sourceField}`,
        trust: entry.trust,
        projection: {
          derived: true,
          sourceSurface: entry.sourceSurface,
          sourceField: entry.sourceField,
          transform: "summary-projection",
          lossy: true,
          rawRetained: false,
        },
        summary: "Projected summary only.",
      })
    );

    expect(refs.every(isGroundingRef)).toBe(true);
    expect(refs.map((ref) => ref.trust)).toEqual([
      "untrusted",
      "untrusted",
      "projected",
      "projected",
    ]);
    expect(refs.every((ref) => ref.authority === "none")).toBe(true);
    expect(refs.every((ref) => ref.projection.lossy === true)).toBe(true);
  });

  it("bounds query results by limit and tokenBudget", () => {
    const refs = Array.from({ length: 5 }, (_, index) =>
      buildGroundingRefFixture({
        id: `bounded_ref_${index}`,
        canonicalKey: `trace:bounded_ref_${index}`,
        ref: `trace:bounded_ref_${index}`,
        summary: `Bounded summary ${index} ${"x".repeat(96)}`,
      })
    );
    const result = buildGroundingResultFixture({
      query: buildGroundingQueryFixture({ limit: 2, tokenBudget: 8 }),
      refs,
    });

    expect(isGroundingResult(result)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.estimatedTokens).toBeLessThanOrEqual(8);
    expect(result.tokenBudget).toBe(8);
    expect(result.omittedRefCount).toBe(refs.length - result.items.length);
  });

  it("does not export grounding persistence, write, service, or mutation helpers", () => {
    const groundingExportNames = Object.keys(groundingExports);
    const runtimeGroundingExports = Object.keys(runtimeCoreExports).filter((key) =>
      /grounding/i.test(key)
    );
    const forbiddenExportPattern =
      /(persist|database|sqlite|store|cache|write|append|save|apply|patchApply|workspaceEdit|rename|service|listener|exporter)/i;

    expectNoForbiddenExports(groundingExportNames, forbiddenExportPattern);
    expectNoForbiddenExports(runtimeGroundingExports, forbiddenExportPattern);
  });
});

function serializedText(value: GroundingRef | GroundingResult): string {
  return JSON.stringify(value);
}

function expectNoSentinels(
  text: string,
  forbidden: readonly string[],
): void {
  expect(forbidden.filter((item) => text.includes(item))).toEqual([]);
}

function expectNoSubstrings(
  text: string,
  forbidden: readonly string[],
): void {
  expect(forbidden.filter((item) => text.includes(item))).toEqual([]);
}

function expectNoForbiddenExports(
  names: readonly string[],
  pattern: RegExp,
): void {
  expect(names.filter((name) => pattern.test(name))).toEqual([]);
}
