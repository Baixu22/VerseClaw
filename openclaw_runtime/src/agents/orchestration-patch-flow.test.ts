import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeferredPatchFlow,
  extractPatchProposalsFromWorkers,
} from "./orchestration-patch-flow.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeWorker(overrides: Partial<SubagentRunRecord>): SubagentRunRecord {
  return {
    runId: "run-worker",
    childSessionKey: "agent:main:worker",
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "agent:main:main",
    task: "implement patch-flow",
    cleanup: "delete",
    createdAt: 1,
    ...overrides,
  };
}

function patchFence(...lines: string[]): string {
  return ["```apply_patch", ...lines, "```"].join("\n");
}

describe("orchestration patch-flow execution", () => {
  it("extracts one apply_patch proposal from frozen worker output", () => {
    const workers = [
      makeWorker({
        runId: "run-1",
        completion: {
          required: true,
          resultText: [
            "## Changes",
            patchFence(
              "*** Begin Patch",
              "*** Update File: src/a.ts",
              "@@",
              "-old",
              "+new",
              "*** End Patch",
            ),
          ].join("\n"),
        },
        orchestration: {
          orchestrationRunId: "orch",
          roleName: "implementer",
          isVerifier: false,
          phase: "worker",
          leadRole: "planner",
          originalTask: "task",
          patchFlowWriteSet: ["src/a.ts"],
        },
      }),
      makeWorker({
        runId: "run-2",
        completion: { required: true, resultText: "No proposal returned." },
      }),
    ];

    expect(extractPatchProposalsFromWorkers(workers)).toEqual([
      {
        workerId: "run-1",
        patchText: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
        writeSet: ["src/a.ts"],
      },
    ]);
  });

  it("serially applies extracted proposals in the real workspace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "patch-flow-deferred-"));
    roots.push(root);
    writeFileSync(path.join(root, "a.txt"), "one\n", "utf8");
    writeFileSync(path.join(root, "b.txt"), "two\n", "utf8");

    const workers = [
      makeWorker({
        runId: "run-a",
        completion: {
          required: true,
          resultText: patchFence(
            "*** Begin Patch",
            "*** Update File: a.txt",
            "@@",
            "-one",
            "+ONE",
            "*** End Patch",
          ),
        },
      }),
      makeWorker({
        runId: "run-b",
        completion: {
          required: true,
          resultText: patchFence(
            "*** Begin Patch",
            "*** Update File: b.txt",
            "@@",
            "-two",
            "+TWO",
            "*** End Patch",
          ),
        },
      }),
    ];

    const outcome = await applyDeferredPatchFlow({
      workers,
      workspaceDir: root,
      now: () => 123,
    });

    expect(outcome).toMatchObject({
      status: "applied",
      proposalCount: 2,
      appliedAt: 123,
      results: [
        { workerId: "run-a", ok: true, summary: { modified: ["a.txt"] } },
        { workerId: "run-b", ok: true, summary: { modified: ["b.txt"] } },
      ],
    });
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("ONE\n");
    expect(readFileSync(path.join(root, "b.txt"), "utf8")).toBe("TWO\n");
  });

  it("records proposal failures and destructive holds without throwing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "patch-flow-fail-"));
    roots.push(root);
    writeFileSync(path.join(root, "a.txt"), "one\n", "utf8");
    writeFileSync(path.join(root, "gone.txt"), "x\n", "utf8");

    const workers = [
      makeWorker({
        runId: "run-valid",
        completion: {
          required: true,
          resultText: patchFence(
            "*** Begin Patch",
            "*** Update File: a.txt",
            "@@",
            "-one",
            "+ONE",
            "*** End Patch",
          ),
        },
      }),
      makeWorker({
        runId: "run-invalid",
        completion: {
          required: true,
          resultText: patchFence(
            "*** Begin Patch",
            "*** Update File: missing.txt",
            "@@",
            "-missing",
            "+value",
            "*** End Patch",
          ),
        },
      }),
      makeWorker({
        runId: "run-destructive",
        completion: {
          required: true,
          resultText: patchFence("*** Begin Patch", "*** Delete File: gone.txt", "*** End Patch"),
        },
      }),
    ];

    const outcome = await applyDeferredPatchFlow({
      workers,
      workspaceDir: root,
      now: () => 456,
    });

    expect(outcome.status).toBe("partial");
    expect(outcome.proposalCount).toBe(3);
    expect(outcome.results.map((result) => [result.workerId, result.ok])).toEqual([
      ["run-valid", true],
      ["run-invalid", false],
      ["run-destructive", false],
    ]);
    expect(outcome.results[1]?.error).toBeTruthy();
    expect(outcome.results[2]?.error).toMatch(/destructive_requires_approval/);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("ONE\n");
    expect(readFileSync(path.join(root, "gone.txt"), "utf8")).toBe("x\n");
  });

  it("reports no-proposals without touching the workspace", async () => {
    const outcome = await applyDeferredPatchFlow({
      workers: [makeWorker({ completion: { required: true, resultText: "report only" } })],
      workspaceDir: undefined,
      now: () => 789,
    });

    expect(outcome).toEqual({
      status: "no-proposals",
      proposalCount: 0,
      results: [],
      appliedAt: 789,
    });
  });

  it("runs a 10-cycle agent-driven serial-apply soak and can emit evidence", async () => {
    const cycles: Array<{ cycle: number; status: string; proposalCount: number; okCount: number }> = [];
    for (let cycle = 1; cycle <= 10; cycle += 1) {
      const root = mkdtempSync(path.join(tmpdir(), `patch-flow-soak-${cycle}-`));
      roots.push(root);
      writeFileSync(path.join(root, "left.txt"), `base-${cycle}\n`, "utf8");
      writeFileSync(path.join(root, "right.txt"), `base-${cycle}\n`, "utf8");
      const workers = [
        makeWorker({
          runId: `run-soak-left-${cycle}`,
          completion: {
            required: true,
            resultText: patchFence(
              "*** Begin Patch",
              "*** Update File: left.txt",
              "@@",
              `-base-${cycle}`,
              `+LEFT-${cycle}`,
              "*** End Patch",
            ),
          },
        }),
        makeWorker({
          runId: `run-soak-right-${cycle}`,
          completion: {
            required: true,
            resultText: patchFence(
              "*** Begin Patch",
              "*** Update File: right.txt",
              "@@",
              `-base-${cycle}`,
              `+RIGHT-${cycle}`,
              "*** End Patch",
            ),
          },
        }),
      ];
      const outcome = await applyDeferredPatchFlow({ workers, workspaceDir: root });
      expect(outcome.status).toBe("applied");
      expect(readFileSync(path.join(root, "left.txt"), "utf8")).toBe(`LEFT-${cycle}\n`);
      expect(readFileSync(path.join(root, "right.txt"), "utf8")).toBe(`RIGHT-${cycle}\n`);
      cycles.push({
        cycle,
        status: outcome.status,
        proposalCount: outcome.proposalCount,
        okCount: outcome.results.filter((result) => result.ok).length,
      });
    }

    const evidencePath = process.env.PATCH_FLOW_SOAK_EVIDENCE_PATH;
    if (evidencePath) {
      mkdirSync(path.dirname(evidencePath), { recursive: true });
      const proposalCount = cycles.reduce((sum, cycle) => sum + cycle.proposalCount, 0);
      const okCount = cycles.reduce((sum, cycle) => sum + cycle.okCount, 0);
      writeFileSync(
        evidencePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            driven_by: "agent",
            actor: "codex",
            generatedAt: new Date().toISOString(),
            task: "TF-0460",
            sourceTest: "openclaw_runtime/src/agents/orchestration-patch-flow.test.ts",
            reproduceCommand:
              "$env:PATCH_FLOW_SOAK_EVIDENCE_PATH='harness/specs/fixtures/patch-flow-execution-orchestrator-wiring/soak.json'; pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-core.config.ts src/agents/orchestration-patch-flow.test.ts --reporter=verbose",
            patchFlowDefault: false,
            cycleCount: cycles.length,
            proposalCount,
            okCount,
            failedCount: proposalCount - okCount,
            status: "applied",
            cycles,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  });

  it("fails closed when proposals exist but the workspace is missing", async () => {
    const worker = makeWorker({
      completion: {
        required: true,
        resultText: patchFence("*** Begin Patch", "*** End Patch"),
      },
    });
    const outcome = await applyDeferredPatchFlow({
      workers: [worker],
      workspaceDir: undefined,
      now: () => 999,
    });

    expect(outcome).toMatchObject({
      status: "failed",
      proposalCount: 1,
      error: "patch_flow_workspace_missing",
    });
  });
});
