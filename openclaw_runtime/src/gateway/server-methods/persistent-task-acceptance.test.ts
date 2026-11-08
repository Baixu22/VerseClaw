import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { tasksHandlers } from "./tasks.js";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../../shared/task-system/identity.js";
import { updateSessionStore } from "../../config/sessions.js";
import { closeSqliteSessionStoreDatabase } from "../../config/sessions/store-sqlite.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { EffectReceiptStore } from "../../agents/effect-receipt.js";

it("accepts owner evidence through the registered Gateway method and rejects a stale session", async () => {
  const root = mkdtempSync(join(tmpdir(), "task-gateway-accept-"));
  const sessionPath = join(root, "sessions.json");
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = join(root, "state");
  const store = new TaskSystemStore(resolveTaskDomain(root));
  try {
    writeFileSync(join(root, "result.txt"), "verified");
    const hash = createHash("sha256").update("verified").digest("hex");
    const task = store.create(
      {
        objective: "Gateway acceptance",
        target: "result.txt",
        constraints: [],
        acceptance: [
          {
            id: "file",
            description: "expected bytes",
            verification: { kind: "file-sha256", path: "result.txt", sha256: hash },
          },
          {
            id: "owner",
            description: "owner verifies evidence",
            verification: { kind: "owner-receipt", owner: "evidence-verifier", requires: ["file"] },
          },
        ],
      },
      "create",
    ).task;
    const claim = store.claim(
      task.contract.taskNodeId,
      "agent:main:main",
      "generation",
      "claim",
    ).claim!;
    await updateSessionStore(sessionPath, (rows) => {
      rows["agent:main:main"] = { sessionId: "generation", updatedAt: Date.now() };
    });
    store.beginOperation(claim, "gateway-run:click", "browser");
    const effect = new EffectReceiptStore().record({
      idempotencyKey: "gateway-effect",
      proposal: { operation: "browser click" },
      domainExecutor: "browser-owner",
      outcome: "applied",
      recoverability: "owner-readback",
      stage1Context: {
        actor: {
          sessionKey: claim.sessionKey,
          runId: "gateway-run",
          attemptIndex: 1,
          modelCallIndex: 1,
          actorKind: "principal",
        },
        effect: { toolCallId: "click", toolName: "browser", resource: "page", action: "click" },
      },
    });
    const reconcile = async (generation: string) => {
      let response: unknown[] = [];
      await tasksHandlers["tasks.contract.reconcile"]({
        params: {
          workspaceDir: root,
          credential: { ...claim, generation },
          operationId: "gateway-run:click",
          effectReceiptId: effect.effectReceiptId,
        },
        context: { getRuntimeConfig: () => ({ session: { store: sessionPath } }) },
        respond: (...args: unknown[]) => {
          response = args;
        },
      } as never);
      return response;
    };
    expect((await reconcile("stale"))[0]).toBe(false);
    expect(store.get(claim.taskNodeId).pendingOperations).toBe(1);
    expect((await reconcile("generation"))[0]).toBe(true);
    expect((await reconcile("generation"))[0]).toBe(true);
    expect(store.get(claim.taskNodeId).pendingOperations).toBe(0);
    store.verifyFile(claim, "file", "result.txt", hash, "candidate");
    store.submit(claim, "candidate");
    const invoke = async (credential: typeof claim) => {
      let response: unknown[] = [];
      await tasksHandlers["tasks.contract.accept"]({
        params: { credential, workspaceDir: root, candidate: "candidate" },
        context: { getRuntimeConfig: () => ({ session: { store: sessionPath } }) },
        respond: (...args: unknown[]) => {
          response = args;
        },
      } as never);
      return response;
    };
    expect((await invoke({ ...claim, generation: "stale" }))[0]).toBe(false);
    expect(store.get(claim.taskNodeId).contract.state).toBe("review");
    expect((await invoke(claim))[0]).toBe(true);
    const proof = store
      .getTaskEvidence(claim.taskNodeId)
      .find((e) => e.criterionId === "owner")!.ownerProof!;
    let receiptResponse: unknown[] = [];
    await tasksHandlers["tasks.contract.receipt"]({
      params: {
        workspaceDir: root,
        refs: {
          taskId: claim.taskNodeId,
          candidateDigest: "candidate",
          generation: "generation",
          verifierReceiptId: proof.verifierReceiptId,
          effectReceiptId: proof.effectReceiptId,
        },
      },
      context: { getRuntimeConfig: () => ({ session: { store: sessionPath } }) },
      respond: (...args: unknown[]) => {
        receiptResponse = args;
      },
    } as never);
    expect(receiptResponse[0]).toBe(true);
    expect(receiptResponse[1]).toMatchObject({
      ok: true,
      claim: { verifierReceiptId: proof.verifierReceiptId, effectReceiptId: proof.effectReceiptId },
    });
    expect(store.get(claim.taskNodeId).contract.state).toBe("done");
    expect((await invoke(claim))[0]).toBe(true);
  } finally {
    store.close();
    closeOpenClawStateDatabase();
    closeSqliteSessionStoreDatabase(sessionPath);
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
