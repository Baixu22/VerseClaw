import { existsSync } from "node:fs";
import type { TaskContextHintV1 } from "../../../../shared/knowledge/code-task-context.js";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { createExecutionTaskAccess } from "../../agents/execution-task-authority.js";
import {
  digestOwnerReadContent,
  isSourceRefV2,
  type SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";

type TaskHintReadInput = {
  workspaceRoot: string;
  sessionKey?: string;
  generation?: string;
  enabled?: boolean;
  sourceRef?: SourceRefV2;
};
const empty = (reason: string): TaskContextHintV1 => ({
  schema: "TaskContextHint/v1",
  status: "unavailable",
  reason,
  constraints: [],
  evidenceRefs: [],
  truncated: false,
});

/** Synchronous final read for a combined code/task response. */
export function readTaskContextHintSnapshot(input: TaskHintReadInput): TaskContextHintV1 {
  if (input.enabled === false) return { ...empty("disabled"), status: "disabled" };
  if (!input.sessionKey || !input.generation) return empty("missing_session_generation");
  let store: TaskSystemStore | undefined;
  try {
    const access = createExecutionTaskAccess(input.workspaceRoot);
    if (!existsSync(access.domain.database)) return empty("missing_ledger");
    store = new TaskSystemStore(access.domain, undefined, access);
    const read = () => {
      const task = store!.binding(input.sessionKey!, input.generation);
      if (!task) return null;
      const evidence = store!
        .getTaskEvidence(task.contract.taskNodeId)
        .filter((ref) => ref.revision === task.contract.revision)
        .map((ref) => ({
          path: ref.path,
          sha256: ref.sha256,
          receiptId: ref.receiptId,
          criterionId: ref.criterionId,
        }));
      const checkpointRevision = task.checkpoint
        ? store!.getTaskCheckpointRevision(task.contract.taskNodeId)
        : undefined;
      const checkpointRefs =
        checkpointRevision === task.contract.revision ? (task.checkpoint?.artifacts ?? []) : [];
      const reason =
        task.checkpoint?.artifacts.length && checkpointRevision !== task.contract.revision
          ? checkpointRevision === undefined
            ? "checkpoint_revision_unknown"
            : "checkpoint_revision_mismatch"
          : undefined;
      const refs = [...evidence, ...checkpointRefs];
      return {
        taskNodeId: task.contract.taskNodeId,
        revision: task.contract.revision,
        contractDigest: task.contract.digest,
        objective: task.contract.objective,
        constraints: task.contract.constraints,
        evidenceRefs: refs,
        reason,
        policyEpoch: digestOwnerReadContent(
          JSON.stringify([
            access.basis,
            input.sessionKey,
            input.generation,
            task.referenceOnly === true,
          ]),
        ),
      };
    };
    const before = read();
    if (!before) return empty("missing_task_binding");
    const after = read();
    if (JSON.stringify(before) !== JSON.stringify(after)) return empty("task_changed");
    const sourceRef: SourceRefV2 = {
      schema: "SourceRef/v2",
      domain: "task",
      authorityId: access.domain.id,
      namespaceId: `task:${access.domain.id}`,
      subjectId: before.taskNodeId,
      revision: String(before.revision),
      sourceDigest: digestOwnerReadContent(JSON.stringify(before)),
      policyEpoch: before.policyEpoch,
    };
    if (
      input.sourceRef &&
      (!isSourceRefV2(input.sourceRef) ||
        input.sourceRef.locator ||
        (
          [
            "domain",
            "authorityId",
            "namespaceId",
            "subjectId",
            "revision",
            "sourceDigest",
            "policyEpoch",
          ] as const
        ).some((key) => input.sourceRef![key] !== sourceRef[key]))
    )
      return empty("task_pin_changed");
    return {
      schema: "TaskContextHint/v1",
      status: "available",
      sourceRef,
      taskNodeId: before.taskNodeId,
      revision: before.revision,
      contractDigest: before.contractDigest,
      ...(before.reason ? { reason: before.reason } : {}),
      objective: before.objective,
      constraints: [...before.constraints],
      evidenceRefs: before.evidenceRefs.slice(0, 32),
      truncated: before.evidenceRefs.length > 32,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "task_owner_unavailable");
  } finally {
    store?.close();
  }
}

export async function readTaskContextHint(
  input: TaskHintReadInput & {
    assertCurrent?: () => void | Promise<void>;
  },
): Promise<TaskContextHintV1> {
  if (input.enabled === false) return { ...empty("disabled"), status: "disabled" };
  try {
    await input.assertCurrent?.();
    const before = readTaskContextHintSnapshot(input);
    await input.assertCurrent?.();
    if (before.status !== "available") return before;
    const after = readTaskContextHintSnapshot({ ...input, sourceRef: before.sourceRef });
    await input.assertCurrent?.();
    const final = readTaskContextHintSnapshot({ ...input, sourceRef: before.sourceRef });
    return after.status === "available" && final.status === "available"
      ? before
      : empty("task_changed");
  } catch (error) {
    return empty(error instanceof Error ? error.message : "task_owner_unavailable");
  }
}
