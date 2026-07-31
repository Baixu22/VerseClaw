import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS,
  AGENT_RUN_INLINE_OUTPUT_MAX_BYTES,
  buildAgentRunEventFixture,
  buildArtifactRefFixture,
  buildExecutionPlanFixture,
  buildObservationV2Fixture,
  buildPolicyDecisionFixture,
  buildProcessHandleFixture,
  createAgentRunRetention,
  isAgentRunEvent,
  isArtifactRef,
  isExecutionPlan,
  isObservationV2,
  isPolicyDecision,
  isProcessHandle,
  sanitizeAgentRunEventForPersistence,
} from "../../openclaw_runtime/src/runtime-core";

describe("UAS-01 contract family", () => {
  it("validates every versioned contract and rejects schema drift", () => {
    const plan = buildExecutionPlanFixture();
    const handle = buildProcessHandleFixture();
    const observation = buildObservationV2Fixture();
    const artifact = buildArtifactRefFixture();
    const decision = buildPolicyDecisionFixture();
    const event = buildAgentRunEventFixture();

    expect(isExecutionPlan(plan)).toBe(true);
    expect(isProcessHandle(handle)).toBe(true);
    expect(isObservationV2(observation)).toBe(true);
    expect(isArtifactRef(artifact)).toBe(true);
    expect(isPolicyDecision(decision)).toBe(true);
    expect(isAgentRunEvent(event)).toBe(true);
    expect(isAgentRunEvent({ ...event, schemaVersion: 2 })).toBe(false);
    expect(isAgentRunEvent({ ...event, schema: "agent.run-event/v2" })).toBe(false);
  });

  it("requires explicit Windows batch interpreter identity for cmd and bat plans", () => {
    const implicitBatch = buildExecutionPlanFixture({
      executable: {
        requested: "build.cmd",
        resolvedPath: "C:\\workspace\\build.cmd",
        kind: "binary",
        identityDigest: `sha256:${"b".repeat(64)}`,
      },
    });
    const missingInterpreter = buildExecutionPlanFixture({
      executable: {
        requested: "build.cmd",
        resolvedPath: "C:\\workspace\\build.cmd",
        kind: "windows_batch",
        identityDigest: `sha256:${"b".repeat(64)}`,
      },
    });
    const explicitBatch = buildExecutionPlanFixture({
      executable: {
        requested: "build.cmd",
        resolvedPath: "C:\\workspace\\build.cmd",
        kind: "windows_batch",
        identityDigest: `sha256:${"b".repeat(64)}`,
        interpreter: {
          requested: "cmd.exe",
          resolvedPath: "C:\\Windows\\System32\\cmd.exe",
          identityDigest: `sha256:${"c".repeat(64)}`,
        },
      },
      argv: ["/d", "/s", "/c", "build.cmd"],
    });

    expect(isExecutionPlan(implicitBatch)).toBe(false);
    expect(isExecutionPlan(missingInterpreter)).toBe(false);
    expect(isExecutionPlan(explicitBatch)).toBe(true);
  });

  it("bounds observation output and keeps artifacts evidence-only", () => {
    const bounded = buildObservationV2Fixture({
      streams: {
        stdout: {
          cursorStart: 0,
          cursorEnd: 8_192,
          truncated: true,
          droppedBytes: 4_096,
          inlineText: "x".repeat(AGENT_RUN_INLINE_OUTPUT_MAX_BYTES),
        },
        stderr: { cursorStart: 0, cursorEnd: 0, truncated: false, droppedBytes: 0 },
      },
    });
    const unbounded = {
      ...bounded,
      streams: {
        ...bounded.streams,
        stdout: {
          ...bounded.streams.stdout,
          inlineText: "x".repeat(AGENT_RUN_INLINE_OUTPUT_MAX_BYTES + 1),
        },
      },
    };

    expect(isObservationV2(bounded)).toBe(true);
    expect(isObservationV2(unbounded)).toBe(false);
    expect(bounded.artifacts.every((artifact) => artifact.memoryEligible === false)).toBe(true);
  });

  it("redacts sensitive payload fields before persistence", () => {
    const plaintext = "uas-secret-canary-123";
    const timestamp = 2_000;
    const plan = buildExecutionPlanFixture({
      envDelta: {
        allowlistedSet: { API_KEY: plaintext, SAFE_MODE: "true" },
        unset: [],
        pathPrepend: [],
      },
      retention: createAgentRunRetention(timestamp),
    });
    const event = buildAgentRunEventFixture({
      timestamp,
      payload: plan,
      retention: createAgentRunRetention(timestamp),
    });

    const sanitized = sanitizeAgentRunEventForPersistence(event);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(plaintext);
    expect(sanitized.redaction.redactedFields).toContain(
      "payload.envDelta.allowlistedSet.API_KEY",
    );
    expect(sanitized.payload.redaction.rawRetained).toBe(false);
    expect(isAgentRunEvent(sanitized)).toBe(true);
  });

  it("rejects unbounded retention windows", () => {
    expect(() => createAgentRunRetention(1, AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS + 1))
      .toThrow(/match the event-log prune owner/);
    expect(() => createAgentRunRetention(1, AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS - 1))
      .toThrow(/match the event-log prune owner/);
  });
});
