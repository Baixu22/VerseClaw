// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionExecutionMigrationRequest } from "../../shared/types/execution-migration";
import type { TaskContractInput } from "../../shared/task-system/types";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { TaskSystemStore } from "../../shared/task-system/store";
import type { OpenClawConfig } from "../../openclaw_runtime/src/config/types.openclaw";
import { clearSessionStoreCacheForTest, getSessionEntry, saveSessionStore } from "../../openclaw_runtime/src/config/sessions/store";
import { resolveSessionFilePath } from "../../openclaw_runtime/src/config/sessions/paths";
import { closeSqliteSessionStoreDatabase } from "../../openclaw_runtime/src/config/sessions/store-sqlite";
import type { SessionEntry } from "../../openclaw_runtime/src/config/sessions/types";
import { openExecutionTaskStore } from "../../openclaw_runtime/src/agents/execution-task-authority";
import { registerExecutionDomain } from "../../openclaw_runtime/src/agents/execution-domain";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { sessionAdmissionRegistry, type SessionAdmissionIdentity } from "../../openclaw_runtime/src/sessions/session-admission-registry";
import {
  createSessionExecutionMigrationOwner,
  type SessionExecutionMigrationFaultPoint,
} from "../../openclaw_runtime/src/gateway/session-execution-migration";
import { readSessionMutationOperationJournal } from "../../openclaw_runtime/src/gateway/session-mutation-operation-journal";

const oldGeneration = "generation-old";
const newGeneration = "generation-new";
const sessionKey = "agent:main:migration";
const operationId = "migration-operation-1";
const transcriptText = [
  JSON.stringify({ type: "session", id: oldGeneration, timestamp: "2026-11-09T00:00:00.000Z" }),
  JSON.stringify({ type: "message", role: "user", content: "preserve this task" }),
  "",
].join("\n");

let root: string;
let sourceRoot: string;
let targetRoot: string;
let storePath: string;
let cfg: OpenClawConfig;
let request: SessionExecutionMigrationRequest;
let sourceTranscriptPath: string;
let targetTranscriptPath: string;
let sourceHash: string;
let clock: number;

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function contract(): TaskContractInput {
  return {
    objective: "Continue the same logical task in another checkout",
    target: "result.txt",
    constraints: ["Keep the original transcript"],
    acceptance: [{ id: "owner", description: "Owner receipt", verification: { kind: "owner-receipt", owner: "runtime-test" } }],
  };
}

function seedTask(): { taskNodeId: string; revision: number; digest: string } {
  const store = new TaskSystemStore(resolveTaskDomain(sourceRoot));
  try {
    const task = store.start({ contract: contract() }, sessionKey, oldGeneration, "source-start");
    return {
      taskNodeId: task.contract.taskNodeId,
      revision: task.contract.revision,
      digest: task.contract.digest,
    };
  } finally {
    store.close();
  }
}

function owner(fault?: (point: SessionExecutionMigrationFaultPoint) => void | Promise<void>) {
  return createSessionExecutionMigrationOwner({
    now: () => ++clock,
    fault,
    inspectDrain: async () => ({ activeRuns: 0, inFlightProcesses: 0, known: true }),
  });
}

function restartRuntime(): void {
  sessionAdmissionRegistry.clearForTests();
  clearSessionStoreCacheForTest();
  closeSqliteSessionStoreDatabase(storePath);
  closeOpenClawStateDatabaseForTest();
}

function sourceIdentity(): SessionAdmissionIdentity {
  return { agentId: "main", canonicalSessionKey: sessionKey, expectedSessionId: oldGeneration };
}

function targetIdentity(): SessionAdmissionIdentity {
  return { agentId: "main", canonicalSessionKey: sessionKey, expectedSessionId: newGeneration };
}

function requireEntry(): SessionEntry {
  const entry = getSessionEntry({ storePath, sessionKey });
  if (!entry) throw new Error("test session missing");
  return entry;
}

function handoffTarget(fromGeneration = oldGeneration, toGeneration = newGeneration, fromRoot = sourceRoot, toRoot = targetRoot): void {
  const sourceStore = openExecutionTaskStore(fromRoot);
  try {
    const source = sourceStore.binding(sessionKey, fromGeneration);
    if (!source?.claim) throw new Error("test source task missing");
    sourceStore.handoff(source.claim, sessionKey, toGeneration, toRoot);
  } finally {
    sourceStore.close();
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "tf0866-runtime-"));
  sourceRoot = path.join(root, "source");
  targetRoot = path.join(root, "target");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(targetRoot, { recursive: true });
  const stateDir = path.join(root, "state");
  storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
  mkdirSync(path.dirname(storePath), { recursive: true });
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  cfg = { session: { store: storePath } };
  clock = Date.now();
  sessionAdmissionRegistry.clearForTests();

  const task = new TaskSystemStore(resolveTaskDomain(sourceRoot));
  task.close();
  registerExecutionDomain({
    workspaceRoot: targetRoot,
    authorityRoot: sourceRoot,
    actor: "agent-runtime-test",
    operationId: "register-target",
    expectedRevision: 0,
    projectRevision: 1,
  });
  closeOpenClawStateDatabaseForTest();
  const taskIdentity = seedTask();

  const sourceEntry: SessionEntry = {
    sessionId: oldGeneration,
    updatedAt: clock,
    workspaceDir: sourceRoot,
    sessionFile: `${oldGeneration}.jsonl`,
    usageFamilyKey: "lineage-stable",
    usageFamilySessionIds: [oldGeneration],
  };
  saveSessionStore(storePath, { [sessionKey]: sourceEntry }, { skipMaintenance: true });
  sourceTranscriptPath = resolveSessionFilePath(oldGeneration, sourceEntry, {
    agentId: "main",
    sessionsDir: path.dirname(storePath),
  });
  writeFileSync(sourceTranscriptPath, transcriptText, "utf8");
  targetTranscriptPath = resolveSessionFilePath(newGeneration, { sessionFile: `${newGeneration}.jsonl` }, {
    agentId: "main",
    sessionsDir: path.dirname(storePath),
  });
  sourceHash = sha256(sourceTranscriptPath);
  request = {
    operationId,
    sessionKey,
    agentId: "main",
    sourceGeneration: oldGeneration,
    targetGeneration: newGeneration,
    sourceRoot,
    targetRoot,
    taskNodeId: taskIdentity.taskNodeId,
    contractRevision: taskIdentity.revision,
    contractDigest: taskIdentity.digest,
  };
});

afterEach(() => {
  restartRuntime();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
describe("runtime session execution migration", () => {
  it.each([
    "after-intent",
    "after-copy",
    "after-store-commit",
    "before-prepare-reply",
  ] satisfies SessionExecutionMigrationFaultPoint[])(
    "recovers the same operation after %s",
    async (faultPoint) => {
      const firstOwner = owner((point) => {
        if (point === faultPoint) throw new Error(`fault:${point}`);
      });
      await expect(firstOwner.prepare(cfg, request)).rejects.toThrow(`fault:${faultPoint}`);

      if (faultPoint === "after-intent" || faultPoint === "after-copy") {
        expect(requireEntry().sessionId).toBe(oldGeneration);
      } else {
        expect(requireEntry().sessionId).toBe(newGeneration);
        expect(requireEntry().executionMigration).toMatchObject({ operationId, state: "prepared" });
      }
      const targetExists = existsSync(targetTranscriptPath);
      expect(sha256(sourceTranscriptPath)).toBe(sourceHash);
      if (targetExists) expect(sha256(targetTranscriptPath)).toBe(sourceHash);

      restartRuntime();
      const resumed = await owner().prepare(cfg, request);
      expect(resumed).toMatchObject({ operationId, state: "prepared", transcriptSha256: sourceHash });
      expect(requireEntry()).toMatchObject({
        sessionId: newGeneration,
        workspaceDir: targetRoot,
        usageFamilyKey: "lineage-stable",
        usageFamilySessionIds: [oldGeneration],
        executionMigration: { operationId, state: "prepared" },
      });
      expect(sha256(sourceTranscriptPath)).toBe(sourceHash);
      expect(sha256(targetTranscriptPath)).toBe(sourceHash);
      expect(() => sessionAdmissionRegistry.acquirePermit(sourceIdentity(), "chat-send")).toThrow(/fenced/);
      expect(() => sessionAdmissionRegistry.acquirePermit(targetIdentity(), "chat-send")).toThrow(/fenced/);
    },
  );

  it("rejects shared id reuse with a changed root or payload", async () => {
    const first = owner();
    const prepared = await first.prepare(cfg, request);
    expect(prepared.state).toBe("prepared");
    await expect(first.prepare(cfg, { ...request, targetRoot: sourceRoot })).rejects.toThrow(/REQUEST_CONFLICT|ROOT_UNCHANGED/);
    await expect(first.prepare(cfg, { ...request, contractDigest: "f".repeat(64) })).rejects.toThrow("SESSION_EXECUTION_MIGRATION_REQUEST_CONFLICT");
    expect(requireEntry().sessionId).toBe(newGeneration);
    expect(sha256(sourceTranscriptPath)).toBe(sourceHash);
    expect(sha256(targetTranscriptPath)).toBe(sourceHash);
  });

  it("keeps prepared closed until the active target task is at the same generation with no pending operation", async () => {
    const sourceStore = openExecutionTaskStore(sourceRoot);
    try {
      const source = sourceStore.binding(sessionKey, oldGeneration);
      if (!source?.claim) throw new Error("test source task missing");
      sourceStore.control(source.claim, "pause");
    } finally {
      sourceStore.close();
    }
    const migration = owner();
    await migration.prepare(cfg, request);
    await expect(migration.confirm(cfg, request)).rejects.toThrow("SESSION_EXECUTION_MIGRATION_TASK_TARGET_OWNER_REQUIRED");

    handoffTarget();
    const confirmed = await migration.confirm(cfg, request);
    expect(confirmed).toMatchObject({ operationId, state: "confirmed", transcriptSha256: sourceHash });
    expect(requireEntry()).toMatchObject({
      sessionId: newGeneration,
      workspaceDir: targetRoot,
      executionMigration: { operationId, state: "confirmed" },
      usageFamilyKey: "lineage-stable",
      usageFamilySessionIds: [oldGeneration],
    });
    expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toMatchObject({ state: "runtime_committed" });
    expect(() => sessionAdmissionRegistry.acquirePermit(sourceIdentity(), "chat-send")).toThrow(/fenced/);
    const release = sessionAdmissionRegistry.acquirePermit(targetIdentity(), "chat-send");
    release();
    expect(await migration.read(cfg, sessionKey, operationId)).toMatchObject({ state: "confirmed" });
  });
});
describe("runtime session execution migration recovery gates", () => {
  it("rejects unknown process ownership before intent and resumes after the owner becomes readable", async () => {
    const unknownOwner = createSessionExecutionMigrationOwner({
      now: () => ++clock,
      inspectDrain: async () => ({ activeRuns: 0, inFlightProcesses: 0, known: false }),
    });
    await expect(unknownOwner.prepare(cfg, request)).rejects.toThrow("SESSION_EXECUTION_MIGRATION_PROCESS_STATE_UNKNOWN");
    expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toBeUndefined();
    expect(requireEntry().sessionId).toBe(oldGeneration);
    expect(existsSync(targetTranscriptPath)).toBe(false);

    restartRuntime();
    const recovered = await owner().prepare(cfg, request);
    expect(recovered.state).toBe("prepared");
    expect(requireEntry().sessionId).toBe(newGeneration);
    expect(existsSync(targetTranscriptPath)).toBe(true);
  });

  it("rejects active target task pending operations and succeeds after settlement", async () => {
    const migration = owner();
    await migration.prepare(cfg, request);
    handoffTarget();

    const taskStore = openExecutionTaskStore(targetRoot);
    let claim;
    try {
      claim = taskStore.binding(sessionKey, newGeneration)?.claim;
      if (!claim) throw new Error("test target claim missing");
      taskStore.db.prepare("INSERT INTO task_operations VALUES(?,?,?,?,?,NULL)").run(
        "pending-target-operation",
        claim.taskNodeId,
        claim.epoch,
        "exec",
        "started",
      );
    } finally {
      taskStore.close();
    }
    await expect(migration.confirm(cfg, request)).rejects.toThrow("SESSION_EXECUTION_MIGRATION_TASK_OPERATIONS_PENDING");

    const settled = openExecutionTaskStore(targetRoot);
    try {
      settled.db.prepare("DELETE FROM task_operations WHERE id=?").run("pending-target-operation");
    } finally {
      settled.close();
    }
    await expect(migration.confirm(cfg, request)).resolves.toMatchObject({ state: "confirmed" });
  });

  it.each(["after-confirm-commit", "before-confirm-reply"] satisfies SessionExecutionMigrationFaultPoint[])(
    "replays confirmation after %s",
    async (faultPoint) => {
      await owner().prepare(cfg, request);
      handoffTarget();
      restartRuntime();
      const interrupted = owner((point) => {
        if (point === faultPoint) throw new Error(`fault:${point}`);
      });
      await expect(interrupted.confirm(cfg, request)).rejects.toThrow(`fault:${faultPoint}`);
      expect(requireEntry().executionMigration).toMatchObject({ operationId, state: "confirmed" });
      expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toMatchObject({
        state: "runtime_committed",
      });

      restartRuntime();
      const replayOwner = owner();
      const replay = await replayOwner.confirm(cfg, request);
      expect(replay).toMatchObject({ operationId, state: "confirmed", transcriptSha256: sourceHash });
      expect(await replayOwner.read(cfg, sessionKey, operationId)).toMatchObject({ state: "confirmed" });
      expect(sha256(sourceTranscriptPath)).toBe(sourceHash);
      expect(sha256(targetTranscriptPath)).toBe(sourceHash);
    },
  );
});
describe("runtime session execution migration transcript and repeat boundaries", () => {
  it("copies a zero-byte transcript by hash without rewriting the source", async () => {
    writeFileSync(sourceTranscriptPath, "", "utf8");
    sourceHash = sha256(sourceTranscriptPath);
    const receipt = await owner().prepare(cfg, request);
    expect(receipt.transcriptSha256).toBe(sourceHash);
    expect(sha256(sourceTranscriptPath)).toBe(sourceHash);
    expect(sha256(targetTranscriptPath)).toBe(sourceHash);
  });

  it("rejects an absent fresh transcript after preserving the operation intent", async () => {
    rmSync(sourceTranscriptPath, { force: true });
    const migration = owner();
    await expect(migration.prepare(cfg, request)).rejects.toThrow("SESSION_EXECUTION_MIGRATION_SOURCE_TRANSCRIPT_MISSING");
    expect(requireEntry().sessionId).toBe(oldGeneration);
    expect(existsSync(sourceTranscriptPath)).toBe(false);
    expect(existsSync(targetTranscriptPath)).toBe(false);
    expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toMatchObject({
      state: "intent",
    });
    expect(await migration.read(cfg, sessionKey, operationId)).toBeNull();
  });

  it("allows a confirmed previous migration to start a new operation", async () => {
    const first = owner();
    await first.prepare(cfg, request);
    handoffTarget();
    await first.confirm(cfg, request);
    expect(requireEntry().executionMigration).toMatchObject({ operationId, state: "confirmed" });

    const thirdRoot = path.join(root, "third");
    mkdirSync(thirdRoot);
    registerExecutionDomain({
      workspaceRoot: thirdRoot,
      authorityRoot: sourceRoot,
      actor: "agent-runtime-test",
      operationId: "register-third",
      expectedRevision: 0,
      projectRevision: 1,
    });
    closeOpenClawStateDatabaseForTest();
    const thirdGeneration = "generation-third";
    const nextRequest: SessionExecutionMigrationRequest = {
      ...request,
      operationId: "migration-operation-2",
      sourceGeneration: newGeneration,
      targetGeneration: thirdGeneration,
      sourceRoot: targetRoot,
      targetRoot: thirdRoot,
    };
    const next = owner();
    await expect(next.prepare(cfg, nextRequest)).resolves.toMatchObject({ operationId: "migration-operation-2", state: "prepared" });
    handoffTarget(newGeneration, thirdGeneration, targetRoot, thirdRoot);
    await expect(next.confirm(cfg, nextRequest)).resolves.toMatchObject({ operationId: "migration-operation-2", state: "confirmed" });
    expect(requireEntry()).toMatchObject({
      sessionId: thirdGeneration,
      workspaceDir: thirdRoot,
      executionMigration: { operationId: "migration-operation-2", state: "confirmed" },
      usageFamilyKey: "lineage-stable",
      usageFamilySessionIds: [oldGeneration],
    });
  });
});
describe("runtime session execution migration request boundaries", () => {
  it.each([
    ["revision", { contractRevision: 0 }, "contractRevision"],
    ["digest", { contractDigest: "g".repeat(64) }, "contractDigest"],
    ["agent", { agentId: "worker" }, "agentId does not match sessionKey"],
    ["length", { taskNodeId: "x".repeat(2049) }, "2048"],
  ] satisfies Array<[string, Partial<SessionExecutionMigrationRequest>, string]>)(
    "rejects invalid %s before writing intent",
    async (_name, patch, error) => {
      await expect(owner().prepare(cfg, { ...request, ...patch })).rejects.toThrow(error);
      expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toBeUndefined();
    },
  );

  it("rejects an equal source and target checkout before writing intent", async () => {
    await expect(owner().prepare(cfg, { ...request, targetRoot: sourceRoot })).rejects.toThrow(
      "SESSION_EXECUTION_MIGRATION_ROOT_UNCHANGED",
    );
    expect(readSessionMutationOperationJournal(storePath, operationId, "session-execution-migrate")).toBeUndefined();
  });

  it("uses spawnedWorkspaceDir as the source owner root and moves it to the target root", async () => {
    const sourceEntry = requireEntry();
    delete sourceEntry.workspaceDir;
    sourceEntry.spawnedWorkspaceDir = sourceRoot;
    saveSessionStore(storePath, { [sessionKey]: sourceEntry }, { skipMaintenance: true });

    await expect(owner().prepare(cfg, request)).resolves.toMatchObject({ state: "prepared" });
    expect(requireEntry()).toMatchObject({
      sessionId: newGeneration,
      workspaceDir: targetRoot,
      spawnedWorkspaceDir: targetRoot,
      executionMigration: { operationId, state: "prepared" },
    });
  });
});