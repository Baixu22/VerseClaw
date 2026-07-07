import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
} from "../../openclaw_runtime/src/agents/task-loop-controller";
import {
  isRuntimeTaskEvent,
  RuntimeTaskEventLogStore,
  type RuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  clearTaskLoopRunsForTests();
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TaskLoop checkpoint evidence integration", () => {
  it("connects subagent evidence to persisted checkpoint metadata and RuntimeTaskEvent event-log output", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "task-loop-checkpoint-evidence-"));
    tempDirs.push(workspace);
    const touchedFile = path.join(workspace, "connected.ts");
    writeFileSync(touchedFile, "export const connectedCheckpointEvidence = true;\n", "utf8");

    const checkpoints: unknown[] = [];
    const shadows: RuntimeTaskEvent[] = [];
    const eventLog = new RuntimeTaskEventLogStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await runTaskLoop(
        {
          task: "connect checkpoint evidence",
          sessionKey: "agent:main:checkpoint-integration",
          workspaceId: "workspace-checkpoint-integration",
        },
        {
          runtime: { eventLog: { shadow: true } },
          agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
        },
        {
          idFactory: (prefix) => `${prefix}_checkpoint_integration`,
          now: () => 1_700_000_000_000,
          ensureTaskLedgerRoot: vi.fn(() => "tlroot_checkpoint_integration"),
          runObserved: (async () => ({
            plan: {
              mode: "lead-workers",
              leadRole: "planner",
              templateId: "quick-development",
              verifierRole: "reviewer",
              reasons: ["template:quick-development"],
              workers: [{ roleName: "implementer", task: "implement" }],
            },
            outcomes: [{
              roleName: "implementer",
              task: "implement",
              isVerifier: false,
              spawn: {
                status: "accepted",
                result: {
                  runId: "run_checkpoint_integration",
                  childSessionKey: "child_checkpoint_integration",
                },
              },
            }],
            spawnedRunIds: ["run_checkpoint_integration"],
            expectedWorkerRunIds: ["run_checkpoint_integration"],
            pendingVerifier: true,
            failures: [],
          })) as never,
          selfCheck: (async () => ({
            decision: "complete",
            confidence: 0.91,
            missingEvidence: [],
            verificationGaps: [],
            risks: [],
            validationState: { status: "passed", checks: ["integration test"], evidenceRefs: [] },
            contextSummary: "checkpoint evidence connected",
          })) as never,
          getSubagentRun: (() => ({
            runId: "run_checkpoint_integration",
            childSessionKey: "child_checkpoint_integration",
            requesterSessionKey: "agent:main:checkpoint-integration",
            requesterDisplayKey: "Main",
            task: "task",
            cleanup: "delete",
            createdAt: 1,
            endedAt: 2,
            outcome: { status: "ok" },
            completion: {
              required: true,
              capturedAt: 2,
              resultText: [
                "```task_loop_evidence",
                JSON.stringify({
                  summary: "Checkpoint evidence integration.",
                  filesTouched: [touchedFile],
                  testsRun: ["vitest run tests/integration/task-loop-checkpoint-evidence.integration.test.ts"],
                }),
                "```",
              ].join("\n"),
            },
          })) as never,
          recordCheckpoint: ((input: unknown) => checkpoints.push(input)) as never,
          runtimeTaskEventShadowSink: (event) => shadows.push(event),
          runtimeTaskEventLogWriter: (event) => eventLog.append(event),
          storeTrace: vi.fn() as never,
        },
      );

      const persistedCheckpoint = checkpoints.at(-1) as {
        checkpoint?: { metadata?: { fileHashes?: Record<string, string> } };
      } | undefined;
      const shadowCheckpoint = shadows.find((event) => event.kind === "checkpoint")?.payload.checkpoint;
      const writtenCheckpoint = eventLog.search({ taskId: result.loopRunId }).records
        .map((record) => record.event)
        .find((event) => event.kind === "checkpoint")?.payload.checkpoint;

      expect(result).toMatchObject({
        loopRunId: "loop_checkpoint_integration",
        status: "complete",
        phase: "complete",
      });
      expect(shadows.every(isRuntimeTaskEvent)).toBe(true);
      expect(persistedCheckpoint?.checkpoint?.metadata?.fileHashes?.[touchedFile]).toMatch(/^[a-f0-9]{64}$/u);
      expect(shadowCheckpoint?.fileHashes?.[touchedFile]).toMatch(/^[a-f0-9]{64}$/u);
      expect(writtenCheckpoint?.fileHashes?.[touchedFile]).toBe(shadowCheckpoint?.fileHashes?.[touchedFile]);
      expect(writtenCheckpoint?.toolResults).toEqual([
        expect.objectContaining({
          callId: "task_loop.subagent:run_checkpoint_integration",
          status: "success",
        }),
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
