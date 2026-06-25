import { describe, expect, it } from "vitest";
import {
  RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
  RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER,
  buildCheckpointFixture,
  buildEvidenceRefFixture,
  buildToolCallResultFixture,
  createRuntimeTaskContinueAsNewShadow,
  deserializeRuntimeCheckpoint,
  serializeRuntimeCheckpoint,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime checkpoint serializer", () => {
  it("round-trips canonical checkpoint fields, refs, metadata, and version markers", () => {
    const firstResult = buildToolCallResultFixture({
      callId: "tool-call-a",
      structuredData: { output: "a" },
      evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool-call-a" })],
    });
    const secondResult = buildToolCallResultFixture({
      callId: "tool-call-b",
      structuredData: { output: "b" },
      evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool-call-b" })],
    });
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-serializer",
      taskId: "task-serializer",
      state: "waiting_tool",
      openObligations: ["Resolve pending tool result.", "Keep evidence attached."],
      contextSummary: "Serializer fixture context summary.",
      toolResults: [firstResult, secondResult],
      fileHashes: {
        "src/b.ts": "sha256:b",
        "src/a.ts": "sha256:a",
      },
      evidenceRefs: [
        buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-serializer" }),
        buildEvidenceRefFixture({ type: "file", ref: "src/a.ts" }),
      ],
    });

    const serialized = serializeRuntimeCheckpoint(checkpoint, {
      toolResultRefs: ["tool-result-ref-a", "tool-result-ref-b"],
      metadata: {
        source: "lane-c",
        versionMarker: "fixture-v1",
      },
      versionMarkers: {
        eventLogSchemaMarker: "runtime.task-event-log.v1",
      },
    });
    const deserialized = deserializeRuntimeCheckpoint(serialized.json);

    expect(serialized.diagnostics).toEqual([]);
    expect(serialized.snapshot?.schemaMarker).toBe(RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER);
    expect(deserialized.diagnostics).toEqual([]);
    expect(deserialized.checkpoint).toEqual({
      ...checkpoint,
      fileHashes: {
        "src/a.ts": "sha256:a",
        "src/b.ts": "sha256:b",
      },
    });
    expect(deserialized.snapshot?.toolResultRefs).toEqual([
      "tool-result-ref-a",
      "tool-result-ref-b",
    ]);
    expect(deserialized.snapshot?.metadata).toEqual({
      source: "lane-c",
      versionMarker: "fixture-v1",
    });
    expect(deserialized.snapshot?.versionMarkers).toMatchObject({
      checkpointSchemaVersion: 1,
      checkpointSerializerSchemaVersion: 1,
      checkpointSerializerSchemaMarker: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
      eventLogSchemaMarker: "runtime.task-event-log.v1",
    });
  });

  it("preserves continue-as-new compaction shadow shape without wiring resume", () => {
    const compaction = createRuntimeTaskContinueAsNewShadow({
      parentTaskId: "task-parent",
      nextTaskId: "task-next",
      checkpointId: "checkpoint-compaction",
      reason: "history_compaction",
      openObligations: ["Carry obligation across compacted history."],
      evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-compaction" })],
      metadata: { compactedEventCount: 512 },
    });
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-compaction",
      taskId: "task-parent",
      state: "completed",
      openObligations: compaction.openObligations,
      evidenceRefs: compaction.evidenceRefs,
    });

    const serialized = serializeRuntimeCheckpoint(checkpoint, { compaction });
    const deserialized = deserializeRuntimeCheckpoint(serialized.json);

    expect(serialized.diagnostics).toEqual([]);
    expect(deserialized.diagnostics).toEqual([]);
    expect(deserialized.snapshot?.compaction).toEqual(compaction);
    expect(deserialized.snapshot?.versionMarkers.continueAsNewSchemaMarker).toBe(
      RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER,
    );
  });

  it("emits schema marker and missing payload diagnostics instead of throwing", () => {
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-mismatch",
      taskId: "task-mismatch",
    });
    const serialized = serializeRuntimeCheckpoint(checkpoint);
    const mismatched = {
      ...serialized.snapshot,
      schemaMarker: "runtime.checkpoint-serializer.v0",
    };
    const missingPayload = {
      schemaVersion: 1,
      schemaMarker: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
      toolResultRefs: [],
      versionMarkers: {
        checkpointSchemaVersion: 1,
        checkpointSerializerSchemaVersion: 1,
        checkpointSerializerSchemaMarker: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
      },
    };
    const invalidCheckpointVersion = {
      ...serialized.snapshot,
      checkpoint: {
        ...checkpoint,
        schemaVersion: 2,
      },
    };

    expect(deserializeRuntimeCheckpoint(mismatched).diagnostics).toEqual([
      expect.objectContaining({
        code: "schema_marker_mismatch",
        recoverable: true,
      }),
    ]);
    expect(deserializeRuntimeCheckpoint(missingPayload).diagnostics).toEqual([
      expect.objectContaining({
        code: "missing_checkpoint_payload",
        recoverable: true,
      }),
    ]);
    expect(deserializeRuntimeCheckpoint(invalidCheckpointVersion).diagnostics).toEqual([
      expect.objectContaining({
        code: "schema_marker_mismatch",
        checkpointId: "checkpoint-mismatch",
        recoverable: true,
      }),
    ]);
  });

  it("serializes deterministically and isolates invalid checkpoint input", () => {
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-deterministic",
      taskId: "task-deterministic",
      fileHashes: {
        z: "sha256:z",
        a: "sha256:a",
      },
    });

    expect(serializeRuntimeCheckpoint(checkpoint).json).toBe(
      serializeRuntimeCheckpoint(checkpoint).json,
    );
    expect(
      serializeRuntimeCheckpoint({
        ...checkpoint,
        checkpointId: "",
      }).diagnostics,
    ).toEqual([
      expect.objectContaining({
        code: "invalid_checkpoint",
        recoverable: true,
      }),
    ]);
  });
});
