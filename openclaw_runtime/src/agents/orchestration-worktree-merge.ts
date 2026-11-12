import {
  createWorktreeService,
  normalizeWorktreeRelPath,
  worktreeRelPathKey,
  type MergeConflictPolicy,
  type WorktreeChangedFiles,
  type MergeQueueItem,
} from "./worktree-service.js";
import { freezeOrchestrationCandidate, type CreateCandidateWorker } from "./orchestration-candidate.js";
import type { VerseGitCandidateResult } from "../../../shared/types/versegit.js";
import { canonicalWorktreePath } from "./worktree-registry.js";
import { readWorktreeFile, worktreeContentHash } from './worktree-merge-files.js';

export type OrchestrationWorktreeMergeWorker = {
  taskNodeId: string;
  worktreeId: string;
  worktreeGeneration: string;
  declaredWriteSet?: readonly string[];
  expectedPostimages?: Record<string, string | null>;
};

export type OrchestrationWorktreeMergeStatus = "merged" | "conflict" | "rework" | "missing";

export type OrchestrationWorktreeMergeResult = {
  taskNodeId: string;
  worktreeId: string;
  worktreeGeneration: string;
  changedFiles: string[];
  changedFilesSource: WorktreeChangedFiles["source"];
  writeSetMismatch: string[];
  status: OrchestrationWorktreeMergeStatus;
  reason?: string;
  journalRef?: string;
  recoveryRequired?: boolean;
  hashes?: Record<string, string | null>;
};

function normalizePaths(paths: readonly string[] | undefined): string[] {
  return [...new Set((paths ?? []).map(normalizeWorktreeRelPath).filter(Boolean))];
}

function symmetricDifference(left: readonly string[], right: readonly string[], root: string, alternate: string): string[] {
  const key = (value: string) => worktreeRelPathKey(value, root, alternate);
  const a = new Set(normalizePaths(left).map(key));
  const b = new Set(normalizePaths(right).map(key));
  return [...new Set([
    ...a,
    ...b,
  ].filter((value) => !(a.has(value) && b.has(value))))].sort();
}

type MergeParameters = {
  assertParentCurrent?: () => void;
  baseRoot: string;
  workers: readonly OrchestrationWorktreeMergeWorker[];
  conflictPolicy?: MergeConflictPolicy;
  prepare?: () => readonly OrchestrationWorktreeMergeWorker[] | Promise<readonly OrchestrationWorktreeMergeWorker[]>;
  onComplete?: (results: readonly OrchestrationWorktreeMergeResult[]) => void;
};

const activeMerges = new Map<string, Promise<OrchestrationWorktreeMergeResult[]>>();
const targetMerges = new Map<string, Promise<void>>();

export async function mergeOrchestrationWorktrees(params: MergeParameters): Promise<OrchestrationWorktreeMergeResult[]> {
  params.assertParentCurrent?.();
  const target = canonicalWorktreePath(params.baseRoot);
  const key = JSON.stringify([target, params.workers.map(worker => ({ ...worker,
    declaredWriteSet: normalizePaths(worker.declaredWriteSet).map(file => worktreeRelPathKey(file, params.baseRoot)).sort() })), params.conflictPolicy ?? "mark_conflict"]);
  const existing = activeMerges.get(key);
  if (existing) return structuredClone(await existing);
  const previous = targetMerges.get(target) ?? Promise.resolve();
  const running = previous.then(async () => {
    // Candidate preparation and receipt publication share the existing target queue.
    const workers = await (params.prepare?.() ?? params.workers);
    try {
      params.assertParentCurrent?.();
      const results = await mergeWorktrees({ ...params, workers });
      params.assertParentCurrent?.();
      params.onComplete?.(results);
      return results;
    } catch (error) {
      const completed = (error as { worktreeMergeResults?: OrchestrationWorktreeMergeResult[] })?.worktreeMergeResults;
      if (Array.isArray(completed)) params.onComplete?.(completed.filter(result => result.status !== 'missing'));
      throw error;
    }
  });
  const settled = running.then(() => {}, () => {});
  targetMerges.set(target, settled);
  activeMerges.set(key, running);
  try { return structuredClone(await running); }
  finally {
    if (activeMerges.get(key) === running) activeMerges.delete(key);
    if (targetMerges.get(target) === settled) targetMerges.delete(target);
  }
}

async function mergeWorktrees(params: MergeParameters): Promise<OrchestrationWorktreeMergeResult[]> {
  if (params.workers.length === 0) return [];
  const service = createWorktreeService(params.baseRoot);
  const pending: Array<{ worker: OrchestrationWorktreeMergeWorker; declaredWriteSet: string[]; changed: WorktreeChangedFiles;
    changedFiles: string[]; writeSetMismatch: string[]; queued: MergeQueueItem }> = [];
  let preparationComplete = false;
  try {
    for (const worker of params.workers) {
      const declaredWriteSet = normalizePaths(worker.declaredWriteSet);
      if (!worker.worktreeGeneration) throw new Error("worktree_generation_required");
      const record = service.list().find(value => value.id === worker.worktreeId && value.generation === worker.worktreeGeneration);
      const terminal = record?.mergeResult?.status === 'merged' ? record.mergeResult : undefined;
      if (terminal && record!.status !== 'cleaned'
        && Object.entries(terminal.hashes ?? {}).some(([file, hash]) => worktreeContentHash(readWorktreeFile(params.baseRoot, file)) !== hash)) {
        const changedFiles = normalizePaths(terminal.changedFiles);
        pending.push({ worker, declaredWriteSet, changed: { files: changedFiles, source: record!.backend === 'git' ? 'git-status' : 'filesystem-snapshot' },
          changedFiles, writeSetMismatch: [], queued: { ...terminal, status: 'conflict', reason: 'worktree_merge_target_changed' } });
        continue;
      }
      const changed: WorktreeChangedFiles = terminal
        ? { files: terminal.changedFiles, source: record!.backend === 'git' ? 'git-status' : 'filesystem-snapshot' }
        : service.listChangedFiles(worker.worktreeId, worker.worktreeGeneration);
      if (changed.source === 'unavailable') throw new Error('worktree_changes_unavailable');
      const changedFiles = changed.source === 'git-status' || changed.files.length > 0 ? normalizePaths(changed.files) : declaredWriteSet;
      const writeSetMismatch = changed.source === "git-status"
        ? symmetricDifference(declaredWriteSet, changedFiles, params.baseRoot, service.pathFor(worker.worktreeId))
        : [];
      const reasonParts: string[] = [];
      if (writeSetMismatch.length > 0) {
        reasonParts.push(`writeSet_mismatch:${writeSetMismatch.join(",")}`);
      }
      const queued = service.enqueueMerge({
        worktreeId: worker.worktreeId,
        worktreeGeneration: worker.worktreeGeneration,
        changedFiles,
        expectedPostimages: worker.expectedPostimages,
        ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
      });
      pending.push({ worker, declaredWriteSet, changed, changedFiles, writeSetMismatch, queued });
    }
    preparationComplete = true;
    const processed = await service.processMergeQueue(undefined, {
    conflictPolicy: params.conflictPolicy ?? "mark_conflict",
    worktreeIds: pending.map((entry) => entry.worker.worktreeId),
    assertParentCurrent: params.assertParentCurrent,
  });
    return describe(processed);
  } catch (error) {
    let failure = error instanceof Error ? error : new Error(String(error));
    let completedPrefix: readonly MergeQueueItem[] = [];
    if (!preparationComplete && pending.length > 0) {
      // Finish only the admitted prefix. Failed preparation cannot strand its queue entries.
      try {
        completedPrefix = await service.processMergeQueue(undefined, { conflictPolicy: params.conflictPolicy ?? 'mark_conflict',
          worktreeIds: pending.map(entry => entry.worker.worktreeId), assertParentCurrent: params.assertParentCurrent });
      } catch (processingError) {
        const later = processingError instanceof Error ? processingError : new Error(String(processingError));
        failure = Object.assign(later, { preparationError: failure });
      }
    }
    throw Object.assign(failure, { worktreeMergeResults: describe([...service.getMergeQueue(), ...completedPrefix]) });
  }
  function describe(processed: readonly MergeQueueItem[]): OrchestrationWorktreeMergeResult[] {
  const identity = (id: string, generation: string | undefined) => JSON.stringify([id, generation]);
  const processedByWorktree = new Map(processed.map((item) => [identity(item.worktreeId, item.worktreeGeneration), item]));
  const records = new Map(service.list().map(record => [record.id, record]));

  return pending.map((entry) => {
    const record = records.get(entry.worker.worktreeId);
    const terminal = record?.generation === entry.worker.worktreeGeneration ? record.mergeResult : undefined;
    const sameFiles = terminal && JSON.stringify(terminal.changedFiles.map(file => worktreeRelPathKey(file, params.baseRoot, record?.root)).sort()) === JSON.stringify(entry.changedFiles.map(file => worktreeRelPathKey(file, params.baseRoot, record?.root)).sort());
    const item = processedByWorktree.get(identity(entry.worker.worktreeId, entry.worker.worktreeGeneration))
      ?? (entry.queued.status === 'conflict' ? entry.queued : sameFiles ? terminal : entry.queued);
    const reasonParts: string[] = [];
    if (entry.writeSetMismatch.length > 0) {
      reasonParts.push(`writeSet_mismatch:${entry.writeSetMismatch.join(",")}`);
    }
    if (item?.reason) reasonParts.push(item.reason);
    return {
      taskNodeId: entry.worker.taskNodeId,
      worktreeId: entry.worker.worktreeId,
      worktreeGeneration: entry.worker.worktreeGeneration,
      changedFiles: entry.changedFiles,
      changedFilesSource: entry.changed.source,
      writeSetMismatch: entry.writeSetMismatch,
      status: item?.status === "pending" || !item ? "missing" : item.status,
      ...(item?.journalRef ? { journalRef: item.journalRef } : {}),
      ...(item?.recoveryRequired ? { recoveryRequired: true } : {}),
      ...(item?.hashes ? { hashes: item.hashes } : {}),
      ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
    };
  });
  }
}

export function freezeOrchestrationWorktreeCandidate(params: {
  baseRoot: string;
  workers: readonly OrchestrationWorktreeMergeWorker[];
  expectedBaseOid?: string;
  allowedRuntimeIgnorePaths?: readonly string[];
}): VerseGitCandidateResult {
  const service = createWorktreeService(params.baseRoot, { backend: "git" });
  const records = new Map(service.list().map((record) => [record.id, record]));
  const workers: CreateCandidateWorker[] = params.workers.map((worker, index) => {
    const record = records.get(worker.worktreeId);
    if (!record) throw new Error(`missing candidate worktree: ${worker.worktreeId}`);
    if (!worker.worktreeGeneration || record.generation !== worker.worktreeGeneration) throw new Error("worktree_stale_generation");
    if (service.inspectIsolation(record.id, worker.worktreeGeneration).status !== "verified") {
      throw new Error(`unverified candidate worktree: ${worker.worktreeId}`);
    }
    return {
      taskNodeId: worker.taskNodeId,
      worktreePath: record.root,
      worktreeRole: worker.worktreeId,
      worktreeGeneration: record.generation,
      declaredWriteSet: worker.declaredWriteSet ?? [],
      parentOrder: index,
    };
  });
  return service.withFrozenWorktrees(params.workers, () => freezeOrchestrationCandidate({
    baseRoot: params.baseRoot,
    workers,
    ...(params.expectedBaseOid ? { expectedBaseOid: params.expectedBaseOid } : {}),
    ...(params.allowedRuntimeIgnorePaths ? { allowedRuntimeIgnorePaths: params.allowedRuntimeIgnorePaths } : {}),
  }));
}
