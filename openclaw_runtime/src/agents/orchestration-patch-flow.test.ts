import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
