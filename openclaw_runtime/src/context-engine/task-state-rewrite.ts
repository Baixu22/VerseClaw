/**
 * C6-4: task_state rewrite-vs-append acceptance.
 * task_state uses stable block_id + BlockStore upsert => rewrite semantics.
 */
import { codingObservability } from "./coding-observability.js";

export type TaskStateRewriteProbe = {
  ok: boolean;
  rewrite: boolean;
  appendDetected: boolean;
  finalContent?: string;
  writeCount: number;
  uniqueBlockIds: number;
  notes: string[];
};

/**
 * Evaluate successive task_state writes for rewrite discipline.
 * Rewrite = same stable block_id; last content wins; not multi-id append.
 */
export function evaluateTaskStateRewrite(params: {
  writes: ReadonlyArray<{ block_id: string; full_content: string }>;
  expectedStableBlockId?: string;
}): TaskStateRewriteProbe {
  const notes: string[] = [];
  const writes = params.writes;
  if (writes.length === 0) {
    codingObservability.recordTaskStateRewrite(false);
    return {
      ok: false,
      rewrite: false,
      appendDetected: false,
      writeCount: 0,
      uniqueBlockIds: 0,
      notes: ["no writes"],
    };
  }
  const ids = new Set(writes.map((w) => w.block_id));
  const uniqueBlockIds = ids.size;
  const expected = params.expectedStableBlockId ?? writes[0]!.block_id;
  const allSameId = writes.every((w) => w.block_id === expected);
  const appendDetected = uniqueBlockIds > 1;
  const rewrite = allSameId && !appendDetected;
  const finalContent = writes[writes.length - 1]!.full_content;
  if (!allSameId) notes.push("block_id drifted across writes (append-shaped)");
  if (appendDetected) notes.push("multiple task_state block ids detected");
  if (rewrite) notes.push("stable block_id rewrite confirmed");
  codingObservability.recordTaskStateRewrite(rewrite);
  return {
    ok: rewrite,
    rewrite,
    appendDetected,
    finalContent,
    writeCount: writes.length,
    uniqueBlockIds,
    notes,
  };
}

/** Canonical task_state block_id used by task-loop handler. */
export function taskStateBlockId(sessionId: string, taskId: string): string {
  return `task-state:${sessionId}:${taskId}`;
}
