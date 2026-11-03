// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitTaskCompletionClaim,
  type TaskCompletionClaimInput,
} from "../../openclaw_runtime/src/runtime-core/task-completion-claim";
import {
  createTaskLedgerEvent,
  projectTaskLedgerSnapshot,
} from "../../electron/services/task-ledger-service";
import { createTaskLedgerApi } from "../../electron/services/task-ledger-api";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@electron/utils/paths", async (original) => ({
  ...await original<object>(),
  getOpenClawConfigDir: () => join(fixture.root, "config"),
}));

const WORKSPACE = "workspace-a3";
let ledger: ReturnType<typeof createTaskLedgerApi>;

beforeEach(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), "autonomy-a3-"));
  ledger = createTaskLedgerApi();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(fixture.root, { recursive: true, force: true });
});

function validClaim(overrides: Partial<TaskCompletionClaimInput> = {}): TaskCompletionClaimInput {
  return {
    taskId: "task-a3",
    activeCandidateDigest: "candidate-a3",
    activeGeneration: "generation-7",
    verifier: {
      taskId: "task-a3",
      verdict: "approved",
      evidenceDigest: "evidence-a3",
      findingCodes: [],
      priorStatus: "review",
      grantsPublish: false,
      grantsProductLock: false,
      candidateDigest: "candidate-a3",
      generation: "generation-7",
    },
    effect: {
      taskId: "task-a3",
      candidateDigest: "candidate-a3",
      generation: "generation-7",
      status: "applied",
      evidenceDigest: "evidence-a3",
      source: "effect-owner",
    },
    ...overrides,
  };
}

describe("A3 bounded task completion admission", () => {
  it("admits only a same-task, same-candidate, same-generation approved verifier plus applied effect", () => {
    const result = admitTaskCompletionClaim(validClaim());
    expect(result).toMatchObject({
      accepted: true,
      transition: { nodeId: "task-a3", from: "review", to: "done" },
      candidateDigest: "candidate-a3",
      generation: "generation-7",
    });
  });

  it.each([
    ["task_mismatch", { verifier: { ...validClaim().verifier, taskId: "task-other" } }],
    ["candidate_mismatch", { verifier: { ...validClaim().verifier, candidateDigest: "old-candidate" } }],
    ["generation_mismatch", { effect: { ...validClaim().effect, generation: "old-generation" } }],
    ["verifier_not_approved", { verifier: { ...validClaim().verifier, verdict: "insufficient-evidence" as const } }],
    ["effect_not_applied", { effect: { ...validClaim().effect, status: "unknown" as const } }],
    ["evidence_mismatch", { effect: { ...validClaim().effect, evidenceDigest: "other-evidence" } }],
    ["already_done", { verifier: { ...validClaim().verifier, priorStatus: "done" } }],
  ])("rejects %s without a done transition", (reason, overrides) => {
    const result = admitTaskCompletionClaim(validClaim(overrides));
    expect(result).toEqual({ accepted: false, reason });
  });

  it("does not treat a completed status label or exit code as evidence", () => {
    const result = admitTaskCompletionClaim({
      taskId: "task-a3",
      activeCandidateDigest: "candidate-a3",
      activeGeneration: "generation-7",
      verifier: {
        taskId: "task-a3",
        verdict: "rejected",
        evidenceDigest: "evidence-a3",
        findingCodes: ["missing_test_evidence"],
        priorStatus: "doing",
        grantsPublish: false,
        grantsProductLock: false,
        candidateDigest: "candidate-a3",
        generation: "generation-7",
      },
      effect: {
        taskId: "task-a3",
        candidateDigest: "candidate-a3",
        generation: "generation-7",
        status: "applied",
        evidenceDigest: "evidence-a3",
        source: "effect-owner",
      },
    });
    expect(result).toEqual({ accepted: false, reason: "verifier_not_approved" });
  });

  it("rejects stale candidate and task evidence before a completion claim can be submitted", () => {
    const result = admitTaskCompletionClaim(validClaim({
      activeCandidateDigest: "candidate-new",
      verifier: { ...validClaim().verifier, candidateDigest: "candidate-old" },
    }));
    expect(result).toEqual({ accepted: false, reason: "candidate_mismatch" });
  });

  it("never grants publish or product-lock authority in the admitted shape", () => {
    const result = admitTaskCompletionClaim(validClaim());
    expect(result).not.toHaveProperty("grantsPublish", true);
    expect(result).not.toHaveProperty("grantsProductLock", true);
  });
});



describe("A3 Task Ledger completion projection", () => {
  it("submits one bound completion event and leaves a receipt readable from the ledger", async () => {
    await ledger.createNode({ workspaceId: WORKSPACE, node: { title: "A3 owner task", status: "review" } });
    const node = (await ledger.snapshot({ workspaceId: WORKSPACE })).snapshot.nodes[0];
    const claim = {
      schema: "TaskCompletionClaim/v1" as const,
      taskId: node.id,
      candidateDigest: "a".repeat(64),
      generation: "generation-7",
      verifierDigest: "b".repeat(64),
      effectDigest: "b".repeat(64),
      priorStatus: "review",
    };
    const result = await ledger.submitCompletion({ workspaceId: WORKSPACE, claim, idempotencyKey: "a3-submit-1" });
    expect(result).toMatchObject({ success: true, accepted: true });
    expect(result.snapshot.nodes.find((candidate) => candidate.id === node.id)).toMatchObject({
      status: "done",
      metadata: { completionClaim: claim },
    });
    const repeated = await ledger.submitCompletion({ workspaceId: WORKSPACE, claim, idempotencyKey: "a3-submit-1" });
    expect(repeated.accepted).toBe(false);
    expect(repeated.reason).toBe("prior_status_mismatch");
  });

  it("does not let an automatic claim complete a check, review, or decision node", async () => {
    await ledger.createNode({ workspaceId: WORKSPACE, node: { title: "A3 check", kind: "check", status: "review" } });
    const node = (await ledger.snapshot({ workspaceId: WORKSPACE })).snapshot.nodes[0];
    const rejected = await ledger.submitCompletion({
      workspaceId: WORKSPACE,
      claim: {
        schema: "TaskCompletionClaim/v1",
        taskId: node.id,
        candidateDigest: "a".repeat(64),
        generation: "generation-7",
        verifierDigest: "b".repeat(64),
        effectDigest: "b".repeat(64),
        priorStatus: "review",
      },
    });
    expect(rejected).toMatchObject({ success: false, accepted: false, reason: "task_kind_not_eligible" });
    expect((await ledger.snapshot({ workspaceId: WORKSPACE })).snapshot.nodes[0]?.status).toBe("review");
  });

  it("rejects stale or incomplete completion claims without writing done", async () => {
    await ledger.createNode({ workspaceId: WORKSPACE, node: { title: "A3 owner task", status: "review" } });
    const node = (await ledger.snapshot({ workspaceId: WORKSPACE })).snapshot.nodes[0];
    const base = {
      schema: "TaskCompletionClaim/v1" as const,
      taskId: node.id,
      candidateDigest: "a".repeat(64),
      generation: "generation-7",
      verifierDigest: "b".repeat(64),
      effectDigest: "c".repeat(64),
      priorStatus: "review",
    };
    const rejected = await ledger.submitCompletion({ workspaceId: WORKSPACE, claim: base });
    expect(rejected).toMatchObject({ success: false, accepted: false, reason: "evidence_mismatch" });
    expect((await ledger.snapshot({ workspaceId: WORKSPACE })).snapshot.nodes[0]?.status).toBe("review");
  });

  it("projects status_changed completion metadata without losing the digest-only claim", () => {
    const timestamp = "2026-11-03T00:00:00.000Z";
    const baseNode = {
      id: "task-a3",
      title: "A3 task",
      kind: "task" as const,
      status: "review" as const,
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const created = createTaskLedgerEvent("workspace-a3", {
      type: "node_created",
      actor: "assistant",
      payload: { node: baseNode },
    });
    const claim = {
      schema: "TaskCompletionClaim/v1" as const,
      taskId: "task-a3",
      candidateDigest: "a".repeat(64),
      generation: "generation-7",
      verifierDigest: "b".repeat(64),
      effectDigest: "b".repeat(64),
      priorStatus: "review",
    };
    const completed = createTaskLedgerEvent("workspace-a3", {
      type: "status_changed",
      actor: "system",
      taskId: "task-a3",
      payload: { nodeId: "task-a3", status: "done", completionClaim: claim },
    });

    const snapshot = projectTaskLedgerSnapshot("workspace-a3", [created, completed]);
    expect(snapshot.nodes[0]).toMatchObject({
      id: "task-a3",
      status: "done",
      metadata: { completionClaim: claim },
    });
  });
});


describe("A3 contract and evidence boundary", () => {
  it("keeps the completion contract, boundary rule, and evidence manifest bound on disk", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const contract = await readFile(join(process.cwd(), "harness/specs/tasks/autonomy-task-completion.md"), "utf8");
    const rule = await readFile(join(process.cwd(), "harness/specs/rules/autonomy-task-completion-boundary.md"), "utf8");
    expect(contract).toContain("complete+repair/blocked/unavailable");
    expect(rule).toContain("同一个 task、candidate digest、generation");
    expect(rule).toContain("effect owner receipt 也为 applied");
    const dir = join(process.cwd(), "harness/specs/fixtures/autonomy-task-completion");
    const manifest = await readFile(join(dir, "SHA256SUMS"), "utf8");
    for (const line of manifest.trim().split(/\r?\n/)) {
      const [expected, file] = line.trim().split(/\s+/);
      const bytes = await readFile(join(dir, file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }
  });
});
