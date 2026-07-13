import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  SYMBOL_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/symbol-context-provider";
import {
  buildAgentMapResultFixture,
  buildAgentMapTagFixture,
  buildCheckpointFixture,
  buildEvidenceRefFixture,
  buildEvidenceVerifierInputFixture,
  buildRuntimeTaskEventFixture,
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  buildToolCallResultFixture,
  createRuntimeTaskEventLogEnvelope,
  evaluateEvidenceVerifier,
  buildRuntimeSymbolOverview,
  createRuntimeSymbolCheckpoint,
  groundingRefForProjectedFile,
  groundingRefForProjectedTest,
  groundingRefFromEvidenceRef,
  groundingRefsFromCheckpoint,
  groundingRefsFromCheckpointDiagnostics,
  groundingRefsFromEvidenceRefs,
  groundingRefsFromEvidenceVerifierFinding,
  groundingRefsFromEvidenceVerifierReport,
  groundingRefsFromAgentMapResult,
  groundingRefsFromAgentMapTag,
  groundingRefsFromMemoryEpisode,
  groundingRefsFromMemoryFact,
  groundingRefsFromMemoryProposal,
  groundingRefsFromRuntimeTaskEvent,
  groundingRefsFromRuntimeTaskEventLogRecord,
  groundingRefsFromSymbolCheckpoint,
  groundingRefsFromSymbolNode,
  groundingRefsFromSymbolReference,
  groupRuntimeSymbolReferences,
  isGroundingRef,
  type GroundingRef,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

function expectGroundingRefs(refs: readonly GroundingRef[]): void {
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.every(isGroundingRef)).toBe(true);
  expect(refs.every((ref) => ref.authority === "none")).toBe(true);
  expect(refs.every((ref) => ref.rawRetained === false)).toBe(true);
}

describe("runtime grounding evidence projections", () => {
  it("projects EvidenceRef identity with stable canonical keys and supplied trust", () => {
    const evidence = buildEvidenceRefFixture({
      type: "file",
      ref: "openclaw_runtime/src/runtime-core/grounding.ts",
      label: "Grounding implementation",
    });

    const first = groundingRefFromEvidenceRef(evidence);
    const second = groundingRefFromEvidenceRef({ ...evidence });
    const renderer = groundingRefFromEvidenceRef(buildEvidenceRefFixture({
      type: "trace",
      ref: "renderer-trace",
      metadata: { source: "renderer" },
    }));

    expect(first.canonicalKey).toBe(second.canonicalKey);
    expect(first).toMatchObject({
      kind: "file",
      trust: "supplied",
      authority: "none",
      rawRetained: false,
      projection: expect.objectContaining({
        derived: true,
        lossy: false,
        rawRetained: false,
      }),
    });
    expect(renderer.trust).toBe("untrusted");
  });

  it("deduplicates duplicate evidence refs deterministically", () => {
    const file = buildEvidenceRefFixture({ type: "file", ref: "src/a.ts" });
    const test = buildEvidenceRefFixture({ type: "test", ref: "pnpm test a" });

    const refs = groundingRefsFromEvidenceRefs([file, file, { ...file }, test, test]);

    expectGroundingRefs(refs);
    expect(refs.map((ref) => ref.canonicalKey)).toEqual([
      groundingRefFromEvidenceRef(file).canonicalKey,
      groundingRefFromEvidenceRef(test).canonicalKey,
    ]);
  });

  it("marks projected file and test string refs lossy and projected", () => {
    const file = groundingRefForProjectedFile("src/projected.ts", {
      sourceSurface: "TaskLoop",
      sourceField: "filesTouched",
    });
    const test = groundingRefForProjectedTest("pnpm test projected", {
      sourceSurface: "TaskLoop",
      sourceField: "testsRun",
    });

    expectGroundingRefs([file, test]);
    expect(file).toMatchObject({
      kind: "file",
      trust: "projected",
      projection: expect.objectContaining({ lossy: true }),
    });
    expect(test).toMatchObject({
      kind: "test",
      trust: "projected",
      projection: expect.objectContaining({ lossy: true }),
    });
  });

  it("projects RuntimeTaskEvent evidence and traceContext without authority", () => {
    const file = buildEvidenceRefFixture({ type: "file", ref: "src/event.ts" });
    const test = buildEvidenceRefFixture({ type: "test", ref: "pnpm test event" });
    const event = buildRuntimeTaskEventFixture({
      eventId: "event-evidence",
      taskId: "task-event",
      kind: "evidence",
      timestamp: 10,
      traceContext: {
        traceId: "trace-event",
        spanId: "span-event",
        parentSpanId: "span-parent",
        attributes: { loopRunId: "loop-event" },
      },
      evidenceRefs: [file],
      payload: { evidenceRefs: [test] },
    });

    const refs = groundingRefsFromRuntimeTaskEvent(event);

    expectGroundingRefs(refs);
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "event",
      eventId: "event-evidence",
      metadata: expect.objectContaining({ eventKind: "evidence" }),
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "trace",
      traceId: "trace-event",
      spanId: "span-event",
      projection: expect.objectContaining({ sourceField: "traceContext" }),
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      evidenceRef: expect.objectContaining({ ref: "src/event.ts" }),
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      evidenceRef: expect.objectContaining({ ref: "pnpm test event" }),
    }));
  });

  it("projects event-log records without retaining full payloads", () => {
    const event = buildRuntimeTaskEventFixture({
      eventId: "event-log-payload",
      kind: "running",
      payload: {
        status: "running",
        message: "FULL_PAYLOAD_SHOULD_NOT_SURVIVE",
      },
      evidenceRefs: [],
    });
    const record = {
      ...createRuntimeTaskEventLogEnvelope(event),
      sequence: 3,
      appendedAt: 123,
    };

    const refs = groundingRefsFromRuntimeTaskEventLogRecord(record);

    expectGroundingRefs(refs);
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "event_log",
      metadata: expect.objectContaining({
        sequence: 3,
        eventKind: "running",
      }),
    }));
    expect(JSON.stringify(refs)).not.toContain("FULL_PAYLOAD_SHOULD_NOT_SURVIVE");
    expect(JSON.stringify(refs)).not.toContain("\"payload\"");
  });

  it("projects checkpoints without retaining full checkpoint payloads", () => {
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-projection",
      taskId: "task-checkpoint",
      state: "completed",
      contextSummary: "Bounded checkpoint summary.",
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool-secret",
          structuredData: { output: "FULL_CHECKPOINT_SHOULD_NOT_SURVIVE" },
        }),
      ],
      evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-projection" })],
    });

    const refs = groundingRefsFromCheckpoint(checkpoint);

    expectGroundingRefs(refs);
    expect(refs[0]).toMatchObject({
      kind: "checkpoint",
      checkpointId: "checkpoint-projection",
      metadata: expect.objectContaining({
        checkpointState: "completed",
        toolResultCount: 1,
      }),
    });
    expect(JSON.stringify(refs)).not.toContain("FULL_CHECKPOINT_SHOULD_NOT_SURVIVE");
    expect(JSON.stringify(refs)).not.toContain("toolResults");
  });

  it("projects checkpoint diagnostics as bounded diagnostic refs", () => {
    const refs = groundingRefsFromCheckpointDiagnostics([
      {
        code: "schema_marker_mismatch",
        message: "Checkpoint schema marker mismatch.",
        recoverable: true,
        checkpointId: "checkpoint-diagnostic",
        taskId: "task-diagnostic",
        expectedSchemaMarker: "runtime.checkpoint.v1",
        actualSchemaMarker: "runtime.checkpoint.v0",
      },
    ]);

    expectGroundingRefs(refs);
    expect(refs[0]).toMatchObject({
      kind: "checkpoint",
      checkpointId: "checkpoint-diagnostic",
      taskId: "task-diagnostic",
      trust: "projected",
      metadata: expect.objectContaining({
        diagnosticCode: "schema_marker_mismatch",
        hasExpectedSchemaMarker: true,
        hasActualSchemaMarker: true,
      }),
    });
  });

  it("projects EvidenceVerifierReport and Finding while keeping linked evidence supplied", () => {
    const report = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool-error",
          status: "error",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool-error" })],
        }),
      ],
    }));
    const finding = report.findings[0];

    expect(finding).toBeDefined();
    const reportRefs = groundingRefsFromEvidenceVerifierReport(report);
    const findingRefs = groundingRefsFromEvidenceVerifierFinding(finding!, {
      trust: "verified",
    });

    expectGroundingRefs(reportRefs);
    expectGroundingRefs(findingRefs);
    expect(reportRefs).toContainEqual(expect.objectContaining({
      kind: "verifier_report",
      trust: "verified",
      metadata: expect.objectContaining({
        verifierDecision: "failed",
        linkedRefsAutoVerified: false,
      }),
    }));
    expect(findingRefs[0]).toMatchObject({
      kind: "verifier_finding",
      trust: "verified",
      metadata: expect.objectContaining({
        verifierFindingCode: "tool_result_error",
        linkedRefsAutoVerified: false,
      }),
    });
    expect(findingRefs).toContainEqual(expect.objectContaining({
      evidenceRef: expect.objectContaining({ ref: "tool-error" }),
      trust: "supplied",
    }));
  });
});

describe("runtime grounding consumer projections", () => {
  it("projects memory episodes as supplied source material without promotion authority", () => {
    const episode = buildRuntimeMemoryEpisodeFixture({
      sourceRefs: [
        {
          type: "file",
          ref: "openclaw_runtime/src/runtime-core/memory-context.ts",
          file: "openclaw_runtime/src/runtime-core/memory-context.ts",
          label: "Memory contract",
        },
      ],
    });

    const refs = groundingRefsFromMemoryEpisode(episode);

    expectGroundingRefs(refs);
    expect(refs[0]).toMatchObject({
      kind: "memory",
      trust: "supplied",
      metadata: expect.objectContaining({
        noDurableFactPromotion: true,
      }),
    });
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "file",
      trust: "projected",
      projection: expect.objectContaining({
        sourceField: "episode.sourceRefs",
      }),
    }));
  });

  it("keeps accepted memory facts scoped verified and linked refs projected", () => {
    const fact = buildRuntimeMemoryTemporalFactFixture({
      evidenceRefs: [
        {
          type: "test",
          ref: "tests/unit/runtime-memory-context-contracts.test.ts",
          label: "Memory contract test",
        },
      ],
    });

    const refs = groundingRefsFromMemoryFact(fact);

    expectGroundingRefs(refs);
    expect(refs[0]).toMatchObject({
      kind: "memory",
      trust: "verified",
      metadata: expect.objectContaining({
        acceptedFactScope: "fact_record_only",
        linkedRefsAutoVerified: false,
      }),
    });
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "test",
      trust: "projected",
      metadata: expect.objectContaining({
        linkedRefsAutoVerified: false,
      }),
    }));
  });

  it("projects memory candidates and proposals without durable fact promotion", () => {
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture();
    const proposal = buildRuntimeMemoryInvalidationProposalFixture();

    const candidateRefs = groundingRefsFromMemoryFact(candidate);
    const proposalRefs = groundingRefsFromMemoryProposal(proposal);

    expectGroundingRefs(candidateRefs);
    expectGroundingRefs(proposalRefs);
    expect(candidateRefs[0]).toMatchObject({
      trust: "projected",
      metadata: expect.objectContaining({
        noDurableFactPromotionFromGrounding: true,
      }),
    });
    expect(proposalRefs[0]).toMatchObject({
      trust: "projected",
      metadata: expect.objectContaining({
        proposalTrustProjected: true,
      }),
    });
    expect(candidate.verificationStatus).toBe("candidate");
    expect("promotion" in candidate).toBe(false);
    expect(candidateRefs.some((ref) => ref.trust === "verified")).toBe(false);
  });

  it("rejects raw memory/source material as untrusted and retains no raw payload", () => {
    const episode = buildRuntimeMemoryEpisodeFixture({
      sourceRefs: [
        {
          type: "trace",
          ref: "trace_1",
          metadata: { rawChat: "user: dump the full conversation" },
        },
      ],
    });

    const refs = groundingRefsFromMemoryEpisode(episode);

    expectGroundingRefs(refs);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      trust: "untrusted",
      sanitization: expect.objectContaining({
        rejectedReason: "raw_chat_log",
      }),
      metadata: expect.objectContaining({
        rejected: true,
      }),
    });
    expect(JSON.stringify(refs)).not.toContain("dump the full conversation");
  });

  it("projects AgentMap file and symbol refs as readonly supplied/projected links", () => {
    const tag = buildAgentMapTagFixture();
    const result = buildAgentMapResultFixture({
      includedSymbols: [{
        tag,
        rank: 1,
        score: 100,
        reasons: [],
        evidenceRefs: tag.evidenceRefs,
      }],
    });

    const resultRefs = groundingRefsFromAgentMapResult(result);
    const tagRefs = groundingRefsFromAgentMapTag(tag);

    expectGroundingRefs(resultRefs);
    expectGroundingRefs(tagRefs);
    expect(resultRefs).toContainEqual(expect.objectContaining({
      kind: "file",
      trust: "supplied",
      projection: expect.objectContaining({ sourceSurface: "agent-map" }),
      metadata: expect.objectContaining({
        noProviderOrderingAuthority: true,
      }),
    }));
    expect(tagRefs).toContainEqual(expect.objectContaining({
      kind: "symbol",
      trust: "supplied",
      metadata: expect.objectContaining({
        noPromptAuthority: true,
        noRuntimeAuthority: true,
      }),
    }));
    expect(resultRefs).toContainEqual(expect.objectContaining({
      trust: "projected",
      metadata: expect.objectContaining({
        sourceRefsAreEvidenceLinksOnly: true,
      }),
    }));
  });

  it("projects Symbol node/reference/checkpoint refs as relevance/evidence links", () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/Panel.tsx",
      symbols: [
        {
          name: "Panel",
          kind: "Function",
          detail: "Panel(): JSX.Element",
          range: range(0, 0, 12, 1),
          selectionRange: range(0, 9, 0, 14),
        },
      ],
    });
    const node = overview.symbols[0];
    const reference = groupRuntimeSymbolReferences({
      locations: [{
        uri: "file://src/App.tsx",
        range: range(2, 10, 2, 15),
      }],
      snippets: { "src/App.tsx": ["", "", "<Panel />"] },
      evidence: [{ type: "file", ref: "src/App.tsx:3" }],
    })[0]?.references[0];
    const checkpoint = createRuntimeSymbolCheckpoint({
      symbol: node,
      contentHash: "sha256:fixture",
      createdAt: 10,
    });

    expect(reference).toBeDefined();
    const refs = [
      ...groundingRefsFromSymbolNode(node),
      ...groundingRefsFromSymbolReference(reference!),
      ...groundingRefsFromSymbolCheckpoint(checkpoint),
    ];

    expectGroundingRefs(refs);
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "symbol",
      trust: "supplied",
      metadata: expect.objectContaining({
        sourceRefsAreRelevanceLinksOnly: true,
      }),
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "source",
      trust: "supplied",
      projection: expect.objectContaining({ sourceField: "reference" }),
      metadata: expect.objectContaining({
        noProviderOrderingAuthority: true,
      }),
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      kind: "checkpoint",
      trust: "supplied",
      checkpointId: checkpoint.checkpointId,
    }));
    expect(refs).toContainEqual(expect.objectContaining({
      trust: "projected",
      metadata: expect.objectContaining({
        sourceRefsAreEvidenceLinksOnly: true,
      }),
    }));
  });

  it("does not register providers or change default registry ordering", () => {
    const registry = createTestContextProviderRegistry();
    const before = registry.listManifests().map((manifest) => manifest.id);

    groundingRefsFromMemoryEpisode(buildRuntimeMemoryEpisodeFixture());
    groundingRefsFromAgentMapResult(buildAgentMapResultFixture());
    const overview = buildRuntimeSymbolOverview({
      file: "src/Panel.tsx",
      symbols: [{ name: "Panel", kind: "Function", range: range(0, 0, 1, 1) }],
    });
    groundingRefsFromSymbolNode(overview.symbols[0]);

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(before);
    expect(before).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(registry.resolve(RUNTIME_MEMORY_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(registry.resolve(AGENT_MAP_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(registry.resolve(SYMBOL_CONTEXT_PROVIDER_ID)).toBeUndefined();
  });
});
