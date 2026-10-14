import {
  createWorktreeService,
  type MergeConflictPolicy,
  type WorktreeChangedFiles,
} from "./worktree-service.js";

export type OrchestrationWorktreeMergeWorker = {
  taskNodeId: string;
  worktreeId: string;
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

export function mergeOrchestrationWorktrees(params: {
  baseRoot: string;
  workers: readonly OrchestrationWorktreeMergeWorker[];
  conflictPolicy?: MergeConflictPolicy;
}): OrchestrationWorktreeMergeResult[] {
  if (params.workers.length === 0) return [];
  const service = createWorktreeService(params.baseRoot);
  const pending = params.workers.map((worker) => {
    const declaredWriteSet = normalizePaths(worker.declaredWriteSet);
    const changed = service.listChangedFiles(worker.worktreeId);
    const changedFiles = changed.files.length > 0 ? normalizePaths(changed.files) : declaredWriteSet;
    const writeSetMismatch = changed.source === "git-status"
      ? symmetricDifference(declaredWriteSet, changedFiles)
      : [];
    const reasonParts: string[] = [];
    if (writeSetMismatch.length > 0) {
      reasonParts.push(`writeSet_mismatch:${writeSetMismatch.join(",")}`);
    }
    service.enqueueMerge({
      worktreeId: worker.worktreeId,
      changedFiles,
      ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
    });
    return { worker, declaredWriteSet, changed, changedFiles, writeSetMismatch };
  });

  const processed = service.processMergeQueue(undefined, {
    conflictPolicy: params.conflictPolicy ?? "mark_conflict",
    worktreeIds: pending.map((entry) => entry.worker.worktreeId),
  });
  const processedByWorktree = new Map(processed.map((item) => [item.worktreeId, item]));

  return pending.map((entry) => {
    const item = processedByWorktree.get(entry.worker.worktreeId);
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
      ...(reasonParts.length > 0 ? { reason: reasonParts.join(";") } : {}),
    };
  });
}