// Durable logical-session migration across execution roots.
//
// The existing session mutation journal is the operation log. The transcript is
// copied without mutating the source; the session store row switch and
// store_committed marker share one SQLite transaction.
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { SessionExecutionMigrationReceipt, SessionExecutionMigrationRequest } from "../../../shared/types/execution-migration.js";
import { canonicalPath } from "../../../shared/task-system/identity.js";
import { openExecutionTaskStore } from "../agents/execution-task-authority.js";
import { getSessionEntry, updateSessionStore } from "../config/sessions/store.js";
import { resolveSessionStoreEntry } from "../config/sessions/store-entry.js";
import { resolveSessionFilePath, resolveStorePath } from "../config/sessions/paths.js";
import { rewriteSessionFileForNewSessionId } from "../config/sessions/session-file-rotation.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { sessionAdmissionRegistry, type SessionAdmissionFenceHandle, type SessionAdmissionIdentity } from "../sessions/session-admission-registry.js";
import {
  buildSessionMutationJournalRow,
  finalizeSessionMutationOperationJournal,
  markSessionMutationOperationStoreCommitted,
  parseSessionMutationReceipt,
  readSessionMutationOperationJournal,
  writeSessionMutationOperationIntent,
  type SessionExecutionMigrationOperationManifest,
} from "./session-mutation-operation-journal.js";
import { buildSessionOperationManifestDigest } from "./session-delete-operation-journal.js";
import { readRuntimeSessionResourceInventory } from "./session-resource-inventory.js";

export type SessionExecutionMigrationFaultPoint =
  | "after-intent"
  | "after-copy"
  | "after-store-commit"
  | "before-prepare-reply"
  | "after-confirm-commit"
  | "before-confirm-reply";

export type SessionExecutionMigrationInternalOptions = {
  now?: () => number;
  fault?: (point: SessionExecutionMigrationFaultPoint, input: { operationId: string; state: "intent" | "store_committed" | "runtime_committed" }) => void | Promise<void>;
  inspectDrain?: (input: {
    agentId: string;
    sessionKey: string;
    generation: string;
    root: string;
  }) => Promise<{ activeRuns: number; inFlightProcesses: number; known: boolean }>;
};

type OperationContext = {
  storePath: string;
  storeIdentity: string;
  sourceIdentity: SessionAdmissionIdentity;
  targetIdentity: SessionAdmissionIdentity;
};

type Journal = NonNullable<ReturnType<typeof readSessionMutationOperationJournal>>;
type DrainInput = Parameters<NonNullable<SessionExecutionMigrationInternalOptions["inspectDrain"]>>[0];
type DrainObservation = { activeRuns: number; inFlightProcesses: number; known: boolean };

function fail(code: string, detail?: unknown): never {
  const suffix = detail === undefined ? "" : `: ${detail instanceof Error ? detail.message : String(detail)}`;
  throw new Error(`${code}${suffix}`);
}

function normalizeRequest(request: SessionExecutionMigrationRequest): SessionExecutionMigrationRequest {
  const fields = [
    request.operationId,
    request.sessionKey,
    request.agentId,
    request.sourceGeneration,
    request.targetGeneration,
    request.sourceRoot,
    request.targetRoot,
    request.taskNodeId,
    request.contractDigest,
  ];
  if (fields.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_INVALID", "missing required field");
  }
  if (fields.some((value) => value.trim().length > 2048)) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_INVALID", "field exceeds 2048 characters");
  }
  if (!Number.isSafeInteger(request.contractRevision) || request.contractRevision < 1) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_INVALID", "contractRevision");
  }
  if (!/^[a-f0-9]{64}$/i.test(request.contractDigest.trim())) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_INVALID", "contractDigest");
  }
  const normalized = {
    operationId: request.operationId.trim(),
    sessionKey: request.sessionKey.trim(),
    agentId: request.agentId.trim(),
    sourceGeneration: request.sourceGeneration.trim(),
    targetGeneration: request.targetGeneration.trim(),
    sourceRoot: path.resolve(request.sourceRoot.trim()),
    targetRoot: path.resolve(request.targetRoot.trim()),
    taskNodeId: request.taskNodeId.trim(),
    contractRevision: request.contractRevision,
    contractDigest: request.contractDigest.trim(),
  };
  const parsed = parseAgentSessionKey(normalized.sessionKey);
  if (!parsed || parsed.agentId !== normalized.agentId) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_INVALID", "agentId does not match sessionKey");
  }
  return normalized;
}

function operationContext(cfg: OpenClawConfig, request: SessionExecutionMigrationRequest): OperationContext {
  const storePath = resolveStorePath(cfg.session?.store, { agentId: request.agentId });
  return {
    storePath,
    storeIdentity: path.resolve(storePath),
    sourceIdentity: {
      agentId: request.agentId,
      canonicalSessionKey: request.sessionKey,
      expectedSessionId: request.sourceGeneration,
    },
    targetIdentity: {
      agentId: request.agentId,
      canonicalSessionKey: request.sessionKey,
      expectedSessionId: request.targetGeneration,
    },
  };
}

function assertRequestScope(request: SessionExecutionMigrationRequest): void {
  let sourceRoot: string;
  let targetRoot: string;
  try {
    sourceRoot = canonicalPath(request.sourceRoot);
    targetRoot = canonicalPath(request.targetRoot);
  } catch (error) {
    fail("SESSION_EXECUTION_MIGRATION_ROOT_UNKNOWN", error);
  }
  if (sourceRoot === targetRoot) fail("SESSION_EXECUTION_MIGRATION_ROOT_UNCHANGED");
  if (request.sourceGeneration === request.targetGeneration) {
    fail("SESSION_EXECUTION_MIGRATION_GENERATION_UNCHANGED");
  }
}

function assertSameRequest(manifest: SessionExecutionMigrationOperationManifest, request: SessionExecutionMigrationRequest): void {
  const digest = buildSessionOperationManifestDigest(request);
  if (manifest.requestDigest !== digest || JSON.stringify(manifest.request) !== JSON.stringify(request)) {
    fail("SESSION_EXECUTION_MIGRATION_REQUEST_CONFLICT");
  }
}

function cloneEntry(entry: SessionEntry): SessionEntry {
  return structuredClone(entry);
}

function assertSourceEntry(entry: SessionEntry, request: SessionExecutionMigrationRequest): void {
  if (entry.sessionId !== request.sourceGeneration) {
    fail("SESSION_EXECUTION_MIGRATION_SOURCE_GENERATION_MISMATCH", entry.sessionId);
  }
  const actualExecutionRoot = entry.workspaceDir?.trim() || entry.spawnedWorkspaceDir?.trim();
  if (!actualExecutionRoot) fail("SESSION_EXECUTION_MIGRATION_SOURCE_ROOT_MISSING");
  try {
    if (canonicalPath(actualExecutionRoot) !== canonicalPath(request.sourceRoot)) {
      fail("SESSION_EXECUTION_MIGRATION_SOURCE_ROOT_MISMATCH");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SESSION_EXECUTION_MIGRATION_")) throw error;
    fail("SESSION_EXECUTION_MIGRATION_SOURCE_ROOT_UNKNOWN", error);
  }
}

function targetEntryFor(
  sourceEntry: SessionEntry,
  request: SessionExecutionMigrationRequest,
  requestDigest: string,
  now: number,
): SessionEntry {
  const sessionFile = rewriteSessionFileForNewSessionId({
    sessionFile: sourceEntry.sessionFile,
    previousSessionId: request.sourceGeneration,
    nextSessionId: request.targetGeneration,
  });
  const next = cloneEntry(sourceEntry);
  next.sessionId = request.targetGeneration;
  next.workspaceDir = request.targetRoot;
  if (sourceEntry.spawnedWorkspaceDir?.trim()) next.spawnedWorkspaceDir = request.targetRoot;
  if (sessionFile) next.sessionFile = sessionFile;
  else delete next.sessionFile;
  next.updatedAt = now;
  next.executionMigration = {
    operationId: request.operationId,
    state: "prepared",
    requestDigest,
    sourceGeneration: request.sourceGeneration,
    targetGeneration: request.targetGeneration,
    sourceRoot: request.sourceRoot,
    targetRoot: request.targetRoot,
    taskNodeId: request.taskNodeId,
    updatedAt: now,
  };
  return next;
}

async function hashExistingFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) fail("SESSION_EXECUTION_MIGRATION_TRANSCRIPT_NOT_FILE", filePath);
    return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof Error && error.message.startsWith("SESSION_EXECUTION_MIGRATION_")) throw error;
    fail("SESSION_EXECUTION_MIGRATION_TRANSCRIPT_READ_FAILED", error);
  }
}

function assertContainedSessionPath(storePath: string, candidate: string): string {
  const sessionsDir = path.resolve(path.dirname(storePath));
  const resolved = path.resolve(candidate);
  const relative = path.relative(sessionsDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("SESSION_EXECUTION_MIGRATION_TRANSCRIPT_OUTSIDE_STORE", candidate);
  }
  return resolved;
}
function assertSourceTask(request: SessionExecutionMigrationRequest, sourceEntry: SessionEntry): void {
  const store = openExecutionTaskStore(request.sourceRoot);
  try {
    const task = store.binding(request.sessionKey, request.sourceGeneration);
    if (!task || task.referenceOnly || !task.claim) fail("SESSION_EXECUTION_MIGRATION_TASK_SOURCE_OWNER_REQUIRED");
    if (
      task.contract.taskNodeId !== request.taskNodeId ||
      task.contract.revision !== request.contractRevision ||
      task.contract.digest !== request.contractDigest
    ) {
      fail("SESSION_EXECUTION_MIGRATION_TASK_SOURCE_MISMATCH");
    }
    if (task.pendingOperations !== 0) fail("SESSION_EXECUTION_MIGRATION_TASK_OPERATIONS_PENDING");
    if (task.claim.generation !== request.sourceGeneration || task.claim.sessionKey !== request.sessionKey) {
      fail("SESSION_EXECUTION_MIGRATION_TASK_SOURCE_GENERATION_MISMATCH");
    }
    store.assertOwner(task.claim, true);
    const active = store.db
      .prepare("SELECT run_id FROM task_active_runs WHERE task_id=? AND epoch=? LIMIT 1")
      .get(task.claim.taskNodeId, task.claim.epoch) as { run_id: string } | undefined;
    if (active) fail("SESSION_EXECUTION_MIGRATION_ACTIVE_RUN", active.run_id);
  } finally {
    store.close();
  }
  if (sourceEntry.executionMigration?.state === "prepared") {
    fail("SESSION_EXECUTION_MIGRATION_ALREADY_PENDING", sourceEntry.executionMigration.operationId);
  }
}

async function buildManifest(input: {
  request: SessionExecutionMigrationRequest;
  sourceEntry: SessionEntry;
  storePath: string;
  storeIdentity: string;
  now: number;
}): Promise<SessionExecutionMigrationOperationManifest> {
  const sourceTranscriptPath = assertContainedSessionPath(
    input.storePath,
    resolveSessionFilePath(input.request.sourceGeneration, input.sourceEntry, {
      agentId: input.request.agentId,
      sessionsDir: path.dirname(input.storePath),
    }),
  );
  const sourceTranscriptSha256 = await hashExistingFile(sourceTranscriptPath);
  const requestDigest = buildSessionOperationManifestDigest(input.request);
  const targetEntry = targetEntryFor(input.sourceEntry, input.request, requestDigest, input.now);
  const targetTranscriptPath = assertContainedSessionPath(
    input.storePath,
    resolveSessionFilePath(input.request.targetGeneration, targetEntry, {
      agentId: input.request.agentId,
      sessionsDir: path.dirname(input.storePath),
    }),
  );
  const existingTargetHash = await hashExistingFile(targetTranscriptPath);
  if (existingTargetHash !== null && existingTargetHash !== sourceTranscriptSha256) {
    fail("SESSION_EXECUTION_MIGRATION_TARGET_TRANSCRIPT_CONFLICT", targetTranscriptPath);
  }
  return {
    version: "1",
    operation: "session-execution-migrate",
    agentId: input.request.agentId,
    storeIdentity: input.storeIdentity,
    canonicalKey: input.request.sessionKey,
    request: input.request,
    requestDigest,
    sourceEntry: cloneEntry(input.sourceEntry),
    targetEntry,
    sourceTranscriptPath,
    targetTranscriptPath,
    sourceTranscriptSha256,
    targetTranscriptSha256: sourceTranscriptSha256,
  };
}

async function ensureTranscriptCopy(manifest: SessionExecutionMigrationOperationManifest): Promise<void> {
  const sourceHash = await hashExistingFile(manifest.sourceTranscriptPath);
  if (sourceHash === null) {
    fail("SESSION_EXECUTION_MIGRATION_SOURCE_TRANSCRIPT_MISSING", manifest.sourceTranscriptPath);
  }
  if (sourceHash !== manifest.sourceTranscriptSha256) {
    fail("SESSION_EXECUTION_MIGRATION_SOURCE_TRANSCRIPT_CHANGED");
  }
  let targetHash = await hashExistingFile(manifest.targetTranscriptPath);
  if (sourceHash !== null && targetHash === null) {
    await fs.mkdir(path.dirname(manifest.targetTranscriptPath), { recursive: true });
    try {
      await fs.copyFile(manifest.sourceTranscriptPath, manifest.targetTranscriptPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        fail("SESSION_EXECUTION_MIGRATION_TRANSCRIPT_COPY_FAILED", error);
      }
    }
    targetHash = await hashExistingFile(manifest.targetTranscriptPath);
  }
  if (targetHash !== sourceHash || targetHash !== manifest.targetTranscriptSha256) {
    fail("SESSION_EXECUTION_MIGRATION_TARGET_TRANSCRIPT_HASH_MISMATCH");
  }
}

function preparedReceipt(manifest: SessionExecutionMigrationOperationManifest): SessionExecutionMigrationReceipt {
  return {
    operationId: manifest.request.operationId,
    sessionKey: manifest.canonicalKey,
    sourceGeneration: manifest.request.sourceGeneration,
    targetGeneration: manifest.request.targetGeneration,
    sourceRoot: manifest.request.sourceRoot,
    targetRoot: manifest.request.targetRoot,
    state: "prepared",
    transcriptPath: manifest.targetTranscriptPath,
    transcriptSha256: manifest.targetTranscriptSha256,
  };
}

function confirmedReceipt(manifest: SessionExecutionMigrationOperationManifest): SessionExecutionMigrationReceipt {
  return { ...preparedReceipt(manifest), state: "confirmed" };
}

function assertPreparedTargetEntry(entry: SessionEntry | undefined, manifest: SessionExecutionMigrationOperationManifest): asserts entry is SessionEntry {
  if (!entry) fail("SESSION_EXECUTION_MIGRATION_TARGET_SESSION_MISSING");
  if (entry.sessionId !== manifest.request.targetGeneration) {
    fail("SESSION_EXECUTION_MIGRATION_TARGET_GENERATION_MISMATCH", entry.sessionId);
  }
  if (!entry.workspaceDir || canonicalPath(entry.workspaceDir) !== canonicalPath(manifest.request.targetRoot)) {
    fail("SESSION_EXECUTION_MIGRATION_TARGET_ROOT_MISMATCH");
  }
  const migration = entry.executionMigration;
  if (
    migration?.operationId !== manifest.request.operationId ||
    migration.state !== "prepared" ||
    migration.requestDigest !== manifest.requestDigest ||
    migration.sourceGeneration !== manifest.request.sourceGeneration ||
    migration.targetGeneration !== manifest.request.targetGeneration ||
    migration.sourceRoot !== manifest.request.sourceRoot ||
    migration.targetRoot !== manifest.request.targetRoot ||
    migration.taskNodeId !== manifest.request.taskNodeId
  ) {
    fail("SESSION_EXECUTION_MIGRATION_TARGET_FLAG_MISMATCH");
  }
}

function assertTargetTask(request: SessionExecutionMigrationRequest): void {
  const store = openExecutionTaskStore(request.targetRoot);
  try {
    let task;
    try {
      task = store.binding(request.sessionKey, request.targetGeneration);
    } catch (error) {
      if (error instanceof Error && error.message === "TASK_GENERATION_STALE") {
        fail("SESSION_EXECUTION_MIGRATION_TASK_TARGET_OWNER_REQUIRED", error);
      }
      throw error;
    }
    if (!task || task.referenceOnly || !task.claim) fail("SESSION_EXECUTION_MIGRATION_TASK_TARGET_OWNER_REQUIRED");
    if (
      task.contract.taskNodeId !== request.taskNodeId ||
      task.contract.revision !== request.contractRevision ||
      task.contract.digest !== request.contractDigest
    ) {
      fail("SESSION_EXECUTION_MIGRATION_TASK_TARGET_MISMATCH");
    }
    if (task.claim.sessionKey !== request.sessionKey || task.claim.generation !== request.targetGeneration) {
      fail("SESSION_EXECUTION_MIGRATION_TASK_TARGET_GENERATION_MISMATCH");
    }
    if (task.claim.worktree !== canonicalPath(request.targetRoot)) {
      fail("SESSION_EXECUTION_MIGRATION_TASK_TARGET_WORKTREE_MISMATCH");
    }
    if (task.pendingOperations !== 0) fail("SESSION_EXECUTION_MIGRATION_TASK_OPERATIONS_PENDING");
    store.assertOwner(task.claim, true);
    const active = store.db
      .prepare("SELECT run_id FROM task_active_runs WHERE task_id=? AND epoch=? LIMIT 1")
      .get(task.claim.taskNodeId, task.claim.epoch) as { run_id: string } | undefined;
    if (active) fail("SESSION_EXECUTION_MIGRATION_TARGET_RUN_ACTIVE", active.run_id);
  } finally {
    store.close();
  }
}

async function inspectDrain(input: DrainInput): Promise<DrainObservation> {
  const inventory = await readRuntimeSessionResourceInventory({
    sessionKey: input.sessionKey,
    agentId: input.agentId,
    expectedSessionId: input.generation,
    rootPath: input.root,
  });
  const processOwner = inventory.owners.find((owner) => owner.kind === "process");
  if (!processOwner || processOwner.state !== "known" || processOwner.count === null || processOwner.pids === null) {
    return { activeRuns: 0, inFlightProcesses: 0, known: false };
  }
  const admission = sessionAdmissionRegistry.snapshot({
    agentId: input.agentId,
    canonicalSessionKey: input.sessionKey,
    expectedSessionId: input.generation,
  });
  if (!admission) return { activeRuns: 0, inFlightProcesses: processOwner.count, known: false };
  return {
    activeRuns: 0,
    inFlightProcesses: processOwner.count + admission.active,
    known: processOwner.pids.length === processOwner.count,
  };
}
async function readJournal(
  context: OperationContext,
  request: SessionExecutionMigrationRequest,
): Promise<Journal | undefined> {
  const journal = readSessionMutationOperationJournal(
    context.storePath,
    request.operationId,
    "session-execution-migrate",
  );
  if (!journal) return undefined;
  const manifest = journal.manifest as SessionExecutionMigrationOperationManifest;
  if (manifest.storeIdentity !== context.storeIdentity || manifest.canonicalKey !== request.sessionKey) {
    fail("SESSION_EXECUTION_MIGRATION_OPERATION_SCOPE_CONFLICT");
  }
  assertSameRequest(manifest, request);
  if (
    journal.state !== "intent" &&
    journal.state !== "store_committed" &&
    journal.state !== "runtime_committed"
  ) {
    fail("SESSION_EXECUTION_MIGRATION_JOURNAL_STATE_INVALID", journal.state);
  }
  return journal;
}

export function createSessionExecutionMigrationOwner(options: SessionExecutionMigrationInternalOptions = {}) {
  const now = options.now ?? Date.now;
  const inspect = options.inspectDrain ?? inspectDrain;
  const queues = new Map<string, Promise<unknown>>();
  const fences = new Map<string, { source: SessionAdmissionFenceHandle; target?: SessionAdmissionFenceHandle }>();

  function serialize<T>(context: OperationContext, operationId: string, run: () => Promise<T>): Promise<T> {
    const key = `${context.storeIdentity}:${operationId}`;
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    queues.set(key, next);
    void next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    }).catch(() => undefined);
    return next;
  }

  async function acquireFences(
    context: OperationContext,
    operationId: string,
    includeTarget: boolean,
  ): Promise<{ source: SessionAdmissionFenceHandle; target?: SessionAdmissionFenceHandle }> {
    const key = `${context.storeIdentity}:${operationId}`;
    const current = fences.get(key);
    const existingSource = current && sessionAdmissionRegistry.ownsFence(current.source) ? current.source : undefined;
    let source = existingSource;
    if (!source) {
      if (sessionAdmissionRegistry.isFenced(context.sourceIdentity)) {
        fail("SESSION_EXECUTION_MIGRATION_SOURCE_ALREADY_FENCED");
      }
      source = await sessionAdmissionRegistry.fence(context.sourceIdentity, { operation: "session-execution-migrate" });
    }
    let target = current && current.target && sessionAdmissionRegistry.ownsFence(current.target) ? current.target : undefined;
    if (includeTarget && !target) {
      try {
        if (sessionAdmissionRegistry.isFenced(context.targetIdentity)) {
          fail("SESSION_EXECUTION_MIGRATION_TARGET_ALREADY_FENCED");
        }
        target = await sessionAdmissionRegistry.fence(context.targetIdentity, { operation: "session-execution-migrate" });
      } catch (error) {
        if (!existingSource) source.release();
        throw error;
      }
    }
    const retained = { source, ...(target ? { target } : {}) };
    fences.set(key, retained);
    return retained;
  }

  function releaseTarget(context: OperationContext, operationId: string): void {
    const key = `${context.storeIdentity}:${operationId}`;
    const retained = fences.get(key);
    retained?.target?.release();
    if (retained) fences.set(key, { source: retained.source });
  }

  async function readReceipt(
    cfg: OpenClawConfig,
    sessionKey: string,
    operationId: string,
  ): Promise<SessionExecutionMigrationReceipt | null> {
    const cleanSessionKey = sessionKey.trim();
    const cleanOperationId = operationId.trim();
    if (!cleanSessionKey || !cleanOperationId) fail("SESSION_EXECUTION_MIGRATION_READ_INVALID");
    const storePath = resolveStorePath(cfg.session?.store, { agentId: cleanSessionKey.split(":")[1] || "main" });
    const journal = readSessionMutationOperationJournal(storePath, cleanOperationId, "session-execution-migrate");
    if (!journal) return null;
    const manifest = journal.manifest as SessionExecutionMigrationOperationManifest;
    if (manifest.canonicalKey !== cleanSessionKey) fail("SESSION_EXECUTION_MIGRATION_SESSION_CONFLICT");
    const context = operationContext(cfg, manifest.request);
    if (journal.state === "runtime_committed") {
      await acquireFences(context, cleanOperationId, false);
      releaseTarget(context, cleanOperationId);
      return parseSessionMutationReceipt<SessionExecutionMigrationReceipt>(journal.receiptJson) ?? confirmedReceipt(manifest);
    }
    if (journal.state === "store_committed") {
      await acquireFences(context, cleanOperationId, true);
      return parseSessionMutationReceipt<SessionExecutionMigrationReceipt>(journal.receiptJson) ?? preparedReceipt(manifest);
    }
    return null;
  }

  async function prepare(
    cfg: OpenClawConfig,
    rawRequest: SessionExecutionMigrationRequest,
  ): Promise<SessionExecutionMigrationReceipt> {
    const request = normalizeRequest(rawRequest);
    const context = operationContext(cfg, request);
    return serialize(context, request.operationId, async () => {
      let journal = await readJournal(context, request);
      if (journal?.state === "runtime_committed") {
        await acquireFences(context, request.operationId, false);
        releaseTarget(context, request.operationId);
        return parseSessionMutationReceipt<SessionExecutionMigrationReceipt>(journal.receiptJson)
          ?? confirmedReceipt(journal.manifest as SessionExecutionMigrationOperationManifest);
      }
      if (journal?.state === "store_committed") {
        const manifest = journal.manifest as SessionExecutionMigrationOperationManifest;
        await acquireFences(context, request.operationId, true);
        assertPreparedTargetEntry(
          getSessionEntry({ storePath: context.storePath, sessionKey: request.sessionKey }),
          manifest,
        );
        await ensureTranscriptCopy(manifest);
        return parseSessionMutationReceipt<SessionExecutionMigrationReceipt>(journal.receiptJson)
          ?? preparedReceipt(manifest);
      }

      let manifest: SessionExecutionMigrationOperationManifest;
      if (journal?.state === "intent") {
        manifest = journal.manifest as SessionExecutionMigrationOperationManifest;
      } else {
        assertRequestScope(request);
        const sourceEntry = getSessionEntry({ storePath: context.storePath, sessionKey: request.sessionKey });
        if (!sourceEntry) fail("SESSION_EXECUTION_MIGRATION_SOURCE_SESSION_MISSING");
        if (sourceEntry.executionMigration?.state === "prepared") {
          fail("SESSION_EXECUTION_MIGRATION_SESSION_ALREADY_PENDING", sourceEntry.executionMigration.operationId);
        }
        assertSourceEntry(sourceEntry, request);
        assertSourceTask(request, sourceEntry);
        manifest = await buildManifest({
          request,
          sourceEntry,
          storePath: context.storePath,
          storeIdentity: context.storeIdentity,
          now: now(),
        });
      }

      await acquireFences(context, request.operationId, true);
      const sourceEntry = getSessionEntry({ storePath: context.storePath, sessionKey: request.sessionKey });
      if (!sourceEntry) fail("SESSION_EXECUTION_MIGRATION_SOURCE_SESSION_MISSING");
      assertSourceEntry(sourceEntry, manifest.request);
      const sourceDrain = await inspect({
        agentId: request.agentId,
        sessionKey: request.sessionKey,
        generation: request.sourceGeneration,
        root: request.sourceRoot,
      });
      if (!sourceDrain.known) fail("SESSION_EXECUTION_MIGRATION_PROCESS_STATE_UNKNOWN");
      if (sourceDrain.activeRuns !== 0) fail("SESSION_EXECUTION_MIGRATION_ACTIVE_RUNS", sourceDrain.activeRuns);
      if (sourceDrain.inFlightProcesses !== 0) {
        fail("SESSION_EXECUTION_MIGRATION_PROCESSES_PENDING", sourceDrain.inFlightProcesses);
      }
      const targetDrain = await inspect({
        agentId: request.agentId,
        sessionKey: request.sessionKey,
        generation: request.targetGeneration,
        root: request.targetRoot,
      });
      if (!targetDrain.known) fail("SESSION_EXECUTION_MIGRATION_TARGET_PROCESS_STATE_UNKNOWN");
      if (targetDrain.activeRuns !== 0) fail("SESSION_EXECUTION_MIGRATION_TARGET_ACTIVE_RUNS", targetDrain.activeRuns);
      if (targetDrain.inFlightProcesses !== 0) {
        fail("SESSION_EXECUTION_MIGRATION_TARGET_PROCESSES_PENDING", targetDrain.inFlightProcesses);
      }

      if (!journal) {
        writeSessionMutationOperationIntent({
          storePath: context.storePath,
          operationId: request.operationId,
          manifest,
        });
        journal = readSessionMutationOperationJournal(
          context.storePath,
          request.operationId,
          "session-execution-migrate",
        );
        if (!journal) fail("SESSION_EXECUTION_MIGRATION_INTENT_NOT_PERSISTED");
        assertSameRequest(journal.manifest as SessionExecutionMigrationOperationManifest, request);
        await options.fault?.("after-intent", { operationId: request.operationId, state: "intent" });
      }

      await ensureTranscriptCopy(manifest);
      await options.fault?.("after-copy", { operationId: request.operationId, state: "intent" });
      const receipt = preparedReceipt(manifest);
      const committed = await updateSessionStore(
        context.storePath,
        (store) => {
          const resolved = resolveSessionStoreEntry({ store, sessionKey: request.sessionKey });
          const current = resolved.existing;
          if (current?.sessionId === request.targetGeneration) {
            assertPreparedTargetEntry(current, manifest);
            return false;
          }
          if (!current || current.sessionId !== request.sourceGeneration) {
            fail("SESSION_EXECUTION_MIGRATION_SOURCE_CHANGED");
          }
          store[resolved.normalizedKey] = cloneEntry(manifest.targetEntry);
          for (const legacyKey of resolved.legacyKeys) delete store[legacyKey];
          return true;
        },
        {
          skipMaintenance: true,
          sqliteJournalRows: [
            buildSessionMutationJournalRow({
              operationId: request.operationId,
              manifest,
              state: "store_committed",
              receiptJson: JSON.stringify(receipt),
            }),
          ],
          skipSaveWhenResult: (changed) => changed === false,
        },
      );
      if (!committed) {
        markSessionMutationOperationStoreCommitted({
          storePath: context.storePath,
          operationId: request.operationId,
          receiptJson: JSON.stringify(receipt),
        });
      }
      await options.fault?.("after-store-commit", { operationId: request.operationId, state: "store_committed" });
      await options.fault?.("before-prepare-reply", { operationId: request.operationId, state: "store_committed" });
      return receipt;
    });
  }
  async function confirm(
    cfg: OpenClawConfig,
    rawRequest: SessionExecutionMigrationRequest,
  ): Promise<SessionExecutionMigrationReceipt> {
    const request = normalizeRequest(rawRequest);
    const context = operationContext(cfg, request);
    return serialize(context, request.operationId, async () => {
      const journal = await readJournal(context, request);
      if (!journal) fail("SESSION_EXECUTION_MIGRATION_NOT_PREPARED");
      const manifest = journal.manifest as SessionExecutionMigrationOperationManifest;
      if (journal.state === "runtime_committed") {
        await acquireFences(context, request.operationId, false);
        releaseTarget(context, request.operationId);
        return parseSessionMutationReceipt<SessionExecutionMigrationReceipt>(journal.receiptJson)
          ?? confirmedReceipt(manifest);
      }
      if (journal.state !== "store_committed") fail("SESSION_EXECUTION_MIGRATION_NOT_PREPARED");
      await acquireFences(context, request.operationId, true);
      assertPreparedTargetEntry(
        getSessionEntry({ storePath: context.storePath, sessionKey: request.sessionKey }),
        manifest,
      );
      await ensureTranscriptCopy(manifest);
      const targetDrain = await inspect({
        agentId: request.agentId,
        sessionKey: request.sessionKey,
        generation: request.targetGeneration,
        root: request.targetRoot,
      });
      if (!targetDrain.known || targetDrain.inFlightProcesses !== 0 || targetDrain.activeRuns !== 0) {
        fail("SESSION_EXECUTION_MIGRATION_TARGET_NOT_SETTLED");
      }
      assertTargetTask(request);
      const receipt = confirmedReceipt(manifest);
      const updated = await updateSessionStore(
        context.storePath,
        (store) => {
          const resolved = resolveSessionStoreEntry({ store, sessionKey: request.sessionKey });
          const current = resolved.existing;
          if (current?.executionMigration?.state === "confirmed") {
            if (current.executionMigration.operationId !== request.operationId) {
              fail("SESSION_EXECUTION_MIGRATION_TARGET_CONFIRMATION_CONFLICT");
            }
            return false;
          }
          assertPreparedTargetEntry(current, manifest);
          store[resolved.normalizedKey] = {
            ...cloneEntry(current),
            updatedAt: now(),
            executionMigration: {
              ...current.executionMigration!,
              state: "confirmed",
              updatedAt: now(),
            },
          };
          for (const legacyKey of resolved.legacyKeys) delete store[legacyKey];
          return true;
        },
        {
          skipMaintenance: true,
          sqliteJournalRows: [
            buildSessionMutationJournalRow({
              operationId: request.operationId,
              manifest,
              state: "runtime_committed",
              receiptJson: JSON.stringify(receipt),
            }),
          ],
          skipSaveWhenResult: (changed) => changed === false,
        },
      );
      if (!updated) {
        finalizeSessionMutationOperationJournal({
          storePath: context.storePath,
          operationId: request.operationId,
          receipt,
        });
      }
      await options.fault?.("after-confirm-commit", {
        operationId: request.operationId,
        state: "runtime_committed",
      });
      releaseTarget(context, request.operationId);
      await options.fault?.("before-confirm-reply", {
        operationId: request.operationId,
        state: "runtime_committed",
      });
      return receipt;
    });
  }

  return { prepare, confirm, read: readReceipt };
}

const defaultOwner = createSessionExecutionMigrationOwner();

export function prepareSessionExecutionMigration(
  cfg: OpenClawConfig,
  request: SessionExecutionMigrationRequest,
): Promise<SessionExecutionMigrationReceipt> {
  return defaultOwner.prepare(cfg, request);
}

export function confirmSessionExecutionMigration(
  cfg: OpenClawConfig,
  request: SessionExecutionMigrationRequest,
): Promise<SessionExecutionMigrationReceipt> {
  return defaultOwner.confirm(cfg, request);
}

export function readSessionExecutionMigration(
  cfg: OpenClawConfig,
  sessionKey: string,
  operationId: string,
): Promise<SessionExecutionMigrationReceipt | null> {
  return defaultOwner.read(cfg, sessionKey, operationId);
}