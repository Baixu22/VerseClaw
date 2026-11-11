import {
  createWorktreeService,
  type MergeConflictPolicy,
  type WorktreeChangedFiles,
} from "./worktree-service.js";
import { freezeOrchestrationCandidate, type CreateCandidateWorker } from "./orchestration-candidate.js";
import type { VerseGitCandidateResult } from "../../../shared/types/versegit.js";

export type OrchestrationWorktreeMergeWorker = {
  taskNodeId: string;
  worktreeId: string;
  worktreeGeneration: string;
  declaredWriteSet?: readonly string[];
};

export type OrchestrationWorktreeMergeStatus = "merged" | "conflict" | "rework" | "missing";

export type OrchestrationWorktreeMergeResult = {
  taskNodeId: string;
  worktreeId: string;
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
  return [...new Set((paths ?? []).map((value) => value.replace(/\\/g, "/").trim()).filter(Boolean))];
}

function symmetricDifference(left: readonly string[], right: readonly string[]): string[] {
  const a = new Set(normalizePaths(left).map((value) => value.toLowerCase()));
  const b = new Set(normalizePaths(right).map((value) => value.toLowerCase()));
  return [...new Set([
    ...a,
    ...b,
  ].filter((value) => !(a.has(value) && b.has(value))))].sort();
}

export async function mergeOrchestrationWorktrees(params: {
  baseRoot: string;
  workers: readonly OrchestrationWorktreeMergeWorker[];
  conflictPolicy?: MergeConflictPolicy;
  assertParentCurrent?: () => void;
}): Promise<OrchestrationWorktreeMergeResult[]> {
  if (params.workers.length === 0) return [];
  const service = createWorktreeService(params.baseRoot);
  const pending = params.workers.map((worker) => {
    const declaredWriteSet = normalizePaths(worker.declaredWriteSet);
    if (!worker.worktreeGeneration) throw new Error("worktree_generation_required");
    const changed = service.listChangedFiles(worker.worktreeId, worker.worktreeGeneration);
    const changedFiles = normalizePaths(changed.files);
    const writeSetMismatch = changed.source !== "unavailable"
      ? symmetricDifference(declaredWriteSet, changedFiles)
      : [];
    const reasonParts: string[] = [];
    if (writeSetMismatch.length > 0) {
      reasonParts.push(`writeSet_mismatch:${writeSetMismatch.join(",")}`);
    }
    const queued = service.enqueueMerge({
      worktreeId: worker.worktreeId,
      worktreeGeneration: worker.worktreeGeneration,
      changedFiles,
      ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
    });
    return { worker, declaredWriteSet, changed, changedFiles, writeSetMismatch, queued };
  });

  const processed = await service.processMergeQueue(undefined, {
    conflictPolicy: params.conflictPolicy ?? "mark_conflict",
    worktreeIds: pending.map((entry) => entry.worker.worktreeId),
    assertParentCurrent: params.assertParentCurrent,
  });
  const processedByWorktree = new Map(processed.map((item) => [item.worktreeId, item]));

  return pending.map((entry) => {
    const item = processedByWorktree.get(entry.worker.worktreeId) ?? entry.queued;
    const reasonParts: string[] = [];
    if (entry.writeSetMismatch.length > 0) {
      reasonParts.push(`writeSet_mismatch:${entry.writeSetMismatch.join(",")}`);
    }
    if (item?.reason) reasonParts.push(item.reason);
    return {
      taskNodeId: entry.worker.taskNodeId,
      worktreeId: entry.worker.worktreeId,
      changedFiles: entry.changedFiles,
      changedFilesSource: entry.changed.source,
      writeSetMismatch: entry.writeSetMismatch,
      status: item?.status === "pending" || !item ? "missing" : item.status,
      journalRef: item?.journalRef,
      recoveryRequired: item?.recoveryRequired,
      hashes: item?.hashes,
      ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
    };
  });
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
