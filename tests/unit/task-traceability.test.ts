// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain, type TaskAuthorityAccess } from "../../shared/task-system/identity";
import { readTaskTrace } from "../../shared/task-system/trace";
import { normalizeRunScope } from "../../shared/types/identity-scope";
import { filesystemInstance } from "../../openclaw_runtime/src/agents/worktree-registry";

const roots: string[] = [],
  stores: TaskSystemStore[] = [];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(root = mkdtempSync(join(tmpdir(), "v1-task-trace-"))) {
  roots.push(root);
  let now = 1_000;
  const domain = resolveTaskDomain(root);
  const access: TaskAuthorityAccess = {
    domain,
    assertCurrent() {},
    resolveRelated: resolveTaskDomain,
    runProvenance: (credential, runId) => ({
      run: normalizeRunScope({
        runId,
        scope: {
          workspaceId: "fixture-workspace",
          projectId: "fixture-workspace",
          sessionKey: credential.sessionKey,
        },
      }),
      authority: {
        localDomainId: domain.id,
        authorityId: domain.id,
        authorityDatabase: domain.database,
        executionWorktree: root,
        registrationRevision: null,
        projectRevision: null,
        identityDigest: hash("fixture"),
        worktreeIncarnation: filesystemInstance(root),
      },
    }),
  };
  const store = new TaskSystemStore(domain, () => now, access);
  stores.push(store);
  const result = "verified result\n";
  const started = store.start(
    {
      contract: {
        objective: "Deliver a traceable result",
        constraints: [],
        target: "result.txt",
        acceptance: [
          {
            id: "bytes",
            description: "Result matches expected bytes",
            verification: { kind: "file-sha256", path: "result.txt", sha256: hash(result) },
          },
        ],
      },
    },
    "agent:main:writer",
    "generation-a",
    "start",
  );
  const credential = started.claim!;
  const step = () => (now += 100);
  step();
  store.beginRun(credential, "run-a");
  step();
  store.beginOperation(credential, "write-result", "write");
  writeFileSync(join(root, "result.txt"), result);
  step();
  store.finishOperation(credential, "write-result", "completed", "write returned");
  step();
  const receipt = store.verifyFile(credential, "bytes", "result.txt", hash(result), "candidate-a");
  step();
  store.submit(credential, "candidate-a");
  step();
  store.accept(credential, "candidate-a");
  step();
  store.endRun(credential, "run-a");
  return {
    store,
    root,
    credential,
    receipt,
    result,
    step,
    taskNodeId: started.contract.taskNodeId,
  };
}
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("Task owner trace projection", () => {
  it("joins original source, actor, run, operation, candidate and checked bytes without writing records", () => {
    const f = fixture(),
      before = f.store.history(f.taskNodeId, 0, 500);
    const report = readTaskTrace(f.store, { taskNodeId: f.taskNodeId }, filesystemInstance);
    expect(report.status).toBe("current");
    expect(report.revisions[0].contract.origin.source).toBeTruthy();
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].credential).toMatchObject({
      sessionKey: "agent:main:writer",
      generation: "generation-a",
      epoch: f.credential.epoch,
    });
    expect(report.runs[0].provenance?.run?.scope.workspaceId).toBe("fixture-workspace");
    expect(report.operations[0]).toMatchObject({
      operationId: "write-result",
      runId: "run-a",
      state: "completed",
    });
    expect(report.candidates[0].candidate).toBe("candidate-a");
    expect(report.checks[0].state).toBe("current");
    expect(report.checks[0].artifacts[0].sha256).toBe(hash(f.result));
    expect(report.phases.execution.durationMs).toBe(600);
    expect(report.costs.totalUsd).toBeNull();
    expect(f.store.history(f.taskNodeId, 0, 500)).toEqual(before);
  });
  it("diagnoses changed artifact bytes and old source or candidate expectations", () => {
    const f = fixture();
    expect(
      readTaskTrace(
        f.store,
        { taskNodeId: f.taskNodeId, digest: hash("old-source") },
        filesystemInstance,
      ).status,
    ).toBe("stale");
    expect(
      readTaskTrace(
        f.store,
        { taskNodeId: f.taskNodeId, candidate: "old-candidate" },
        filesystemInstance,
      ).diagnostics,
    ).toContainEqual({ code: "candidate_changed", ref: "old-candidate" });
    writeFileSync(join(f.root, "result.txt"), "modified after acceptance");
    const report = readTaskTrace(f.store, { taskNodeId: f.taskNodeId }, filesystemInstance);
    expect(report.status).toBe("stale");
    expect(report.checks[0].state).toBe("stale");
  });
  it("rejects a replaced checkout incarnation even when its file bytes match", () => {
    const f = fixture();
    const report = readTaskTrace(
      f.store,
      { taskNodeId: f.taskNodeId },
      () => "replacement-incarnation",
    );
    expect(report.status).toBe("stale");
    expect(report.checks[0].artifacts[0].sourceState).toBe("replaced");
  });
  it("diagnoses missing source and run events instead of reconstructing invented history", () => {
    const f = fixture();
    f.store.db
      .prepare("DELETE FROM task_events WHERE task_id=? AND kind IN ('created','run_started')")
      .run(f.taskNodeId);
    const report = readTaskTrace(f.store, { taskNodeId: f.taskNodeId }, filesystemInstance);
    expect(report.status).toBe("incomplete");
    expect(report.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["source_missing", "run_missing", "receipt_invalid"]),
    );
  });
  it("does not bless a fabricated evidence row without its matching owner event", () => {
    const f = fixture();
    const forged = { ...f.receipt, receiptId: "fabricated-receipt", verifier: "invented-owner" };
    f.store.db
      .prepare("INSERT INTO task_evidence VALUES(?,?,?)")
      .run(forged.receiptId, f.taskNodeId, JSON.stringify(forged));
    const report = readTaskTrace(f.store, { taskNodeId: f.taskNodeId }, filesystemInstance);
    expect(report.status).toBe("incomplete");
    expect(report.checks.find((check) => check.receipt.receiptId === forged.receiptId)?.state).toBe(
      "incomplete",
    );
  });
  it("keeps exact evidence queryable after actual Git worktree cleanup", () => {
    const root = mkdtempSync(join(tmpdir(), "v1-retained-trace-"));
    roots.push(root);
    const repo = join(root, "repo"),
      tree = join(root, "tree");
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        windowsHide: true,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    git("init", "-q");
    git("config", "user.name", "Trace fixture");
    git("config", "user.email", "trace@example.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "result.txt"), "verified result\n");
    git("add", "result.txt");
    git("commit", "-qm", "fixture");
    git("worktree", "add", "--detach", tree);
    const f = fixture(tree);
    const operation = f.store.prepareWorktreeCleanup(tree, repo, "trace-cleanup");
    f.store.withWorktreeCleanup(tree, () => git("worktree", "remove", tree));
    f.store.completeWorktreeCleanup(operation, f.store.domain.worktree);
    const report = readTaskTrace(f.store, { taskNodeId: f.taskNodeId }, filesystemInstance);
    expect(report.status).toBe("current");
    expect(report.checks[0]).toMatchObject({
      state: "retained",
      artifacts: [{ state: "retained", sourceState: "reclaimed" }],
    });
    expect(report.cleanup.map((event) => event.kind)).toContain("worktree_cleanup_completed");
  });
});
