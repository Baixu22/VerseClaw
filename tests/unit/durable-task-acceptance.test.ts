// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, it, describe, expect, vi } from "vitest";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { acceptPersistentTask } from "../../openclaw_runtime/src/agents/persistent-task-acceptance";
import { EffectReceiptStore } from "../../openclaw_runtime/src/agents/effect-receipt";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
const registry = vi.hoisted(() => ({ run: null as unknown }));
vi.mock("../../openclaw_runtime/src/agents/subagent-registry-read", () => ({
  getSubagentRunByRunId: () => registry.run,
}));

let root: string, store: TaskSystemStore;
const oldState = process.env.OPENCLAW_STATE_DIR;
const hash = createHash("sha256").update("verified artifact").digest("hex");
beforeEach(() => {
  registry.run = null;
  root = mkdtempSync(join(tmpdir(), "task-owner-acceptance-"));
  process.env.OPENCLAW_STATE_DIR = join(root, "state");
  store = new TaskSystemStore(resolveTaskDomain(root));
  writeFileSync(join(root, "artifact.txt"), "verified artifact");
});
afterEach(() => {
  store.close();
  closeOpenClawStateDatabase();
  if (oldState === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = oldState;
  rmSync(root, { recursive: true, force: true });
});

function task() {
  const created = store.create(
    {
      objective: "Deliver the accepted artifact",
      target: "artifact.txt",
      constraints: [],
      acceptance: [
        {
          id: "file",
          description: "Approved bytes",
          verification: { kind: "file-sha256", path: "artifact.txt", sha256: hash },
        },
        {
          id: "verified",
          description: "Verifier evaluates actual file evidence",
          verification: { kind: "owner-receipt", owner: "evidence-verifier", requires: ["file"] },
        },
      ],
    },
    "create",
  ).task;
  const c = store.claim(created.contract.taskNodeId, "parent", "generation", "claim").claim!;
  store.submit(c, "candidate");
  return c;
}

describe("existing verifier and effect owners", () => {
  it("requires an independent verifier run bound to the unchanged input snapshot", () => {
    const t = store.create(
      {
        objective: "Independent verification",
        target: "artifact.txt",
        constraints: [],
        acceptance: [
          {
            id: "review",
            description: "Independent verifier approves this artifact",
            verification: {
              kind: "owner-receipt",
              owner: "subagent-verifier",
              files: ["artifact.txt"],
            },
          },
        ],
      },
      "create",
    ).task;
    const c = store.claim(t.contract.taskNodeId, "parent", "generation", "claim").claim!;
    store.submit(c, "candidate");
    store.prepareWriterDelegation(c, {
      delegationId: "review-run",
      childSessionKey: "reviewer",
      childGeneration: "review-generation",
      childRunId: "review-run",
      childWorktree: root,
      mode: "observer",
    });
    store.returnDelegatedWriter("reviewer", {
      runId: "review-run",
      endedAt: Date.now(),
      outcome: "ok",
      parentGeneration: "generation",
    });
    registry.run = {
      runId: "review-run",
      childSessionKey: "reviewer",
      requesterSessionKey: "parent",
      endedAt: Date.now(),
      outcome: { status: "ok" },
      orchestration: { isVerifier: true, verificationVerdict: "fail" },
    };
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("VERIFIER_NOT_APPROVED");
    registry.run = {
      ...(registry.run as object),
      orchestration: { isVerifier: true, verificationVerdict: "pass" },
    };
    writeFileSync(join(root, "artifact.txt"), "changed after verification");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("VERIFIER_CANDIDATE_CHANGED");
    writeFileSync(join(root, "artifact.txt"), "verified artifact");
    expect(acceptPersistentTask(store, c, "candidate").contract.state).toBe("done");
  });
  it("reads actual evidence, records an existing effect receipt, and accepts only the current candidate", () => {
    const c = task();
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("EVIDENCE_MISSING");
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    const accepted = acceptPersistentTask(store, c, "candidate");
    expect(accepted.contract.state).toBe("done");
    const proof = store
      .getTaskEvidence(c.taskNodeId)
      .find((e) => e.criterionId === "verified")!.ownerProof!;
    const effects = new EffectReceiptStore();
    expect(effects.getById(proof.effectReceiptId)?.domain_executor).toBe(
      "task-verification-journal",
    );
    expect(effects.getById(proof.effectReceiptId)?.outcome).toBe("applied");
    expect(acceptPersistentTask(store, c, "candidate").contract.state).toBe("done");
    expect(() => acceptPersistentTask(store, c, "different")).toThrow("COMPLETION_REPLAY_MISMATCH");
  });
  it("rejects artifacts changed after the requirement was checked", () => {
    const c = task();
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    writeFileSync(join(root, "artifact.txt"), "changed");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("EVIDENCE_STALE");
    expect(store.get(c.taskNodeId).contract.state).toBe("review");
  });
  it("does not accept caller-chosen unknown owners", () => {
    const t = store.create(
      {
        objective: "unknown owner",
        target: "artifact.txt",
        constraints: [],
        acceptance: [
          {
            id: "owner",
            description: "verify",
            verification: { kind: "owner-receipt", owner: "model-says-pass" },
          },
        ],
      },
      "create",
    ).task;
    const c = store.claim(t.contract.taskNodeId, "a", "g", "claim").claim!;
    store.submit(c, "candidate");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("OWNER_VERIFIER_UNAVAILABLE");
  });
  it("rejects new generations and unresolved operations before completing", () => {
    const c = task();
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    expect(() => acceptPersistentTask(store, { ...c, generation: "wrong" }, "candidate")).toThrow(
      "STALE_OWNER",
    );
    expect(store.get(c.taskNodeId).contract.state).toBe("review");
  });
});
