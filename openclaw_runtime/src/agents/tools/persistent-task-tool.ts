import { Type } from "typebox";
import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { readProjectCoordinator } from "../../../../shared/task-system/project-coordinator.js";
import { createExecutionTaskAccess } from "../execution-task-authority.js";
import { getSessionEntry } from '../../config/sessions/store.js';
import type {
  TaskCheckpoint,
  TaskContractInput,
  TaskCredential,
  TaskPlanItem,
  ProjectPlanInput,
  TaskQuery,
} from "../../../../shared/task-system/types.js";
import type { AnyAgentTool } from "./common.js";

const taskContractSchema = Type.Object({
  objective: Type.String({ maxLength: 3000 }),
  target: Type.String(),
  constraints: Type.Array(Type.String(), { maxItems: 30 }),
  expectedOutcomes: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
  acceptance: Type.Array(
    Type.Object({
      id: Type.String(),
      description: Type.String(),
      verification: Type.Union([
        Type.Object({
          kind: Type.Literal("file-sha256"),
          path: Type.String(),
          sha256: Type.String(),
        }),
        Type.Object({
          kind: Type.Literal("tool-result"),
          tool: Type.Literal("exec"),
          command: Type.String(),
          files: Type.Array(Type.String()),
          exitCode: Type.Integer(),
        }),
        Type.Object({
          kind: Type.Literal("owner-receipt"),
          owner: Type.String(),
          requires: Type.Optional(Type.Array(Type.String())),
          files: Type.Optional(Type.Array(Type.String())),
        }),
      ]),
    }),
    { minItems: 1, maxItems: 20 },
  ),
  businessKey: Type.Optional(Type.String()),
  occurrenceKey: Type.Optional(Type.String()),
  dependencies: Type.Optional(Type.Array(Type.String())),
});

/** Session identity comes from the runtime, never from model-authored arguments. */
export function createPersistentTaskTool(input: {
  workspace: string;
  sessionKey?: string;
  generation?: string;
}): AnyAgentTool {
  let pinned: TaskCredential | null = null;
  const access = createExecutionTaskAccess(input.workspace);
  const initialDomain = access.domain;
  if (existsSync(initialDomain.database) && input.sessionKey) {
    const initial = new TaskSystemStore(initialDomain, undefined, access);
    try {
      const view = initial.binding(input.sessionKey, input.generation);
      pinned = view?.referenceOnly ? null : (view?.claim ?? null);
    } finally {
      initial.close();
    }
  }
  return {
    name: "task_control",
    label: "Task control",
    risk: "write",
    description:
      "When explicitly asked to execute the next project plan task, read planStatus, then use startNextPlanTask with the parent taskNodeId, expectedRevision and a stable requestId. This claims one dependency-ready task; worker admission is separate. " +
      "Manage execution tasks quietly in conversation. For explicit project planning requests in a project coordinator session, read planStatus and relevant project facts first, then use savePlan with goal contract, a bounded list of children with concrete verification, local dependsOn keys, and nextAction. Record uncertain facts as assumptions and unresolved major scope choices as decisions; scope those tasks to work that is safe under those uncertainties. Change an existing plan explicitly with taskNodeId, expectedRevision, and revisionReason; keep the requestId stable across retries and use a new ID for a new goal. Planning does not start execution. Before implementation, read current and use start with either taskNodeId or a complete contract to resolve and claim atomically. Derive goals and verifiable checks from the user request and repository; do not ask for task forms, internal IDs, or manual claims. Ordinary discussion creates no task. Report progress and genuine blockers plainly, checkpoint progress, and submit candidate-bound evidence for acceptance. Use stable request IDs across retries; suggestions do not grant identity. Use history to trace candidate checks and retention receipts; readRetainedArtifact returns verified bytes in bounded base64 pages after source cleanup. Task ownership does not grant tool permissions. Never replace the goal with a status question.",
    parameters: Type.Object({
      action: Type.Union(
        [
          "list",
          "suggest",
          "decompose",
          "planStatus",
          "savePlan",
          "startNextPlanTask",
          "reconcile",
          "changes",
          "history",
          "readRetainedArtifact",
          "acknowledge",
          "current",
          "create",
          "start",
          "revise",
          "claim",
          "checkpoint",
          "pause",
          "resume",
          "release",
          "cancel",
          "submit",
          "verifyFile",
          "accept",
        ].map((x) => Type.Literal(x)),
      ),
      taskNodeId: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      target: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      cursor: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      children: Type.Optional(
        Type.Array(
          Type.Object({
            key: Type.String({ maxLength: 80 }),
            contract: taskContractSchema,
            dependsOn: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
          }),
          { minItems: 1, maxItems: 30 },
        ),
      ),
      operationId: Type.Optional(Type.String()),
      effectReceiptId: Type.Optional(Type.String()),
      receiptId: Type.Optional(Type.String()),
      afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      length: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536 })),
      expectedSequence: Type.Optional(Type.Integer({ minimum: 0 })),
      throughSequence: Type.Optional(Type.Integer({ minimum: 0 })),
      requestId: Type.Optional(Type.String()),
      expectedRevision: Type.Optional(Type.Integer({minimum:1})),
      revisionReason: Type.Optional(Type.String({ maxLength: 500 })),
      nextAction: Type.Optional(Type.String({ maxLength: 500 })),
      assumptions: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 30 })),
      decisions: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 30 })),
      contract: Type.Optional(taskContractSchema),
      checkpoint: Type.Optional(Type.Unknown()),
      candidate: Type.Optional(Type.String()),
      criterionId: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      sha256: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, raw) => {
      if (!input.sessionKey || !input.generation) throw new Error("TASK_SESSION_IDENTITY_REQUIRED");
      const p = raw as Record<string, unknown>;
      const planning = p.action === "planStatus" || p.action === "savePlan" || p.action === "startNextPlanTask";
      const scope = planning ? (() => {
        const ownerPath = process.env.CLAWX_WORKSPACE_OWNER_PATH;
        if (!ownerPath) throw new Error("TASK_PROJECT_COORDINATOR_REQUIRED");
        const entry = getSessionEntry({ sessionKey: input.sessionKey! });
        if (entry?.sessionId !== input.generation) throw new Error("TASK_GENERATION_STALE");
        return readProjectCoordinator(ownerPath, input.sessionKey!, input.generation!, input.workspace, p.action === "startNextPlanTask");
      })() : undefined;
      if (process.env.CLAWX_TASK_SCOPE_BRIDGE === '1' && !['list','current','status','changes','history','readRetainedArtifact','suggest'].includes(String(p.action))) {
        const session=getSessionEntry({sessionKey:input.sessionKey});
        if ((session as {executionMigration?:{state?:string}}|undefined)?.executionMigration?.state==='prepared')throw new Error('TASK_EXECUTION_MIGRATION_PENDING');
      }
      access.assertCurrent();
      const domain = access.domain;
      if (!existsSync(domain.database) && ['history', 'readRetainedArtifact'].includes(String(p.action))) throw new Error('TASK_STORE_UNAVAILABLE');
      if (!existsSync(domain.database) && (p.action === "list" || p.action === "current" || p.action === "planStatus"))
        return {
          content: [{ type: "text", text: p.action === "list" ? '{"tasks":[]}' : "null" }],
          details: p.action === "list" ? { tasks: [] } : null,
        };
      const store = new TaskSystemStore(domain, undefined, access);
      try {
        const str = (key: string) => {
          if (typeof p[key] !== "string" || !(p[key] as string).trim())
            throw new Error(`TASK_REQUIRED_${key}`);
          return p[key] as string;
        };
        if (scope) {
          if (p.action === "startNextPlanTask") {
            const result = store.startNextPlanTask(scope, str("taskNodeId"), Number(p.expectedRevision), str("requestId"), pinned ?? undefined);
            pinned = result.claim;
            return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
          }
          const result = p.action === "planStatus"
            ? store.projectPlan(scope.workspaceId, typeof p.taskNodeId === "string" ? p.taskNodeId : undefined) ?? null
            : store.saveProjectPlan(scope, {
                requestId: str("requestId"), goal: p.contract as ProjectPlanInput["goal"],
                children: p.children as TaskPlanItem[], nextAction: str("nextAction"),
                assumptions: p.assumptions as string[] | undefined, decisions: p.decisions as string[] | undefined,
                revise: p.taskNodeId !== undefined || p.expectedRevision !== undefined || p.revisionReason !== undefined
                  ? { taskNodeId: str("taskNodeId"), expectedRevision: Number(p.expectedRevision), reason: str("revisionReason") }
                  : undefined,
              });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
        }
        const current = store.binding(input.sessionKey, input.generation);
        let result: unknown;
        if (p.action === "accept" && !current?.claim) {
          const id = typeof p.taskNodeId === "string" ? p.taskNodeId : pinned?.taskNodeId;
          if (!id) throw new Error("TASK_ID_REQUIRED_FOR_COMPLETION_REPLAY");
          const task = store.replayCompletedTask(
            id,
            input.sessionKey,
            input.generation,
            str("candidate"),
          );
          return { content: [{ type: "text", text: JSON.stringify(task) }], details: task };
        }
        if (p.action === 'history') result = store.history(str('taskNodeId'), typeof p.afterSequence === 'number' ? p.afterSequence : undefined, typeof p.limit === 'number' ? p.limit : undefined);
        else if (p.action === 'readRetainedArtifact') result = store.readRetainedArtifactPage(str('taskNodeId'), str('receiptId'),
          typeof p.offset === 'number' ? p.offset : undefined, typeof p.length === 'number' ? p.length : undefined);
        else if (p.action === "changes")
          result = store.changes(
            input.sessionKey,
            typeof p.limit === "number" ? p.limit : undefined,
          );
        else if (p.action === "acknowledge") {
          store.acknowledge(
            input.sessionKey,
            Number(p.expectedSequence),
            Number(p.throughSequence),
          );
          result = { acknowledged: true };
        } else if (p.action === "list")
          result = store.page({
            query: typeof p.query === "string" ? p.query : undefined,
            cursor: typeof p.cursor === "string" ? p.cursor : undefined,
            limit: typeof p.limit === "number" ? p.limit : undefined,
            state: p.state as TaskQuery["state"],
          });
        else if (p.action === "suggest")
          result = store.suggest(
            str("query"),
            typeof p.target === "string" ? p.target : undefined,
            typeof p.limit === "number" ? p.limit : undefined,
          );
        else if (p.action === "current") result = current;
        else if (p.action === "decompose" && pinned)
          result = store.decompose(pinned, p.children as TaskPlanItem[], str("requestId"));
        else if (p.action === "start") {
          result=store.start({taskNodeId:typeof p.taskNodeId==='string'?p.taskNodeId:undefined,contract:p.contract as TaskContractInput|undefined},input.sessionKey,input.generation,str('requestId'),pinned??undefined);
          const claim=(result as {claim:TaskCredential}).claim;
          store.assertOwner(claim);
          pinned=claim;
        } else if (p.action === "create")
          result = store.create(p.contract as TaskContractInput, str("requestId"), undefined, {
            source: "runtime-task-tool",
            sessionKey: input.sessionKey,
          });
        else if (p.action === "claim") {
          result = store.claim(
            str("taskNodeId"),
            input.sessionKey,
            input.generation,
            str("requestId"),
            pinned ?? undefined,
          );
          const claimed = (result as { claim: TaskCredential }).claim;
          if (
            pinned &&
            (pinned.epoch !== claimed.epoch || pinned.taskNodeId !== claimed.taskNodeId)
          )
            throw new Error("TASK_RESTART_RUN_AFTER_HANDOFF");
          pinned = claimed;
        } else if (
          p.action === "cancel" &&
          current?.referenceOnly &&
          current.claim?.sessionKey === input.sessionKey &&
          current.claim.generation === input.generation
        ) {
          if (pinned && (pinned.taskNodeId !== current.claim.taskNodeId || ![pinned.epoch, pinned.epoch + 1].includes(current.claim.epoch))) throw new Error("TASK_STALE_OWNER");
          result = store.control(current.claim, "cancel");
        } else {
          if (!current?.claim || current.referenceOnly) throw new Error("TASK_CLAIM_REQUIRED");
          if (
            pinned &&
            (pinned.epoch !== current.claim.epoch || pinned.taskNodeId !== current.claim.taskNodeId)
          )
            throw new Error("TASK_STALE_OWNER");
          const c = pinned ?? current.claim;
          pinned = c;
          if (p.action === "revise") {
            store.assertOwner(c);
            result = store.revise(c.taskNodeId, Number(p.expectedRevision), p.contract as TaskContractInput);
          } else if (p.action === "decompose")
            result = store.decompose(c, p.children as TaskPlanItem[], str("requestId"));
          else if (p.action === "reconcile") {
            const { reconcilePersistentTaskEffect } =
              await import("../persistent-task-acceptance.js");
            result = reconcilePersistentTaskEffect(
              store,
              c,
              str("operationId"),
              str("effectReceiptId"),
            );
          } else if (p.action === "checkpoint")
            result = store.checkpoint(c, p.checkpoint as TaskCheckpoint);
          else if (p.action === "resume") {
            result = store.handoff(c, input.sessionKey, input.generation);
            pinned = (result as { claim: TaskCredential }).claim;
          } else if (p.action === "pause" || p.action === "release" || p.action === "cancel") {
            result = store.control(c, p.action);
            pinned = (result as { claim: TaskCredential }).claim;
          } else if (p.action === "submit") result = store.submit(c, str("candidate"));
          else if (p.action === "verifyFile")
            result = store.verifyFile(
              c,
              str("criterionId"),
              str("path"),
              str("sha256"),
              str("candidate"),
            );
          else if (p.action === "accept") {
            const { acceptPersistentTask } = await import("../persistent-task-acceptance.js");
            result = acceptPersistentTask(store, c, str("candidate"));
          } else throw new Error("TASK_UNKNOWN_ACTION");
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } finally {
        store.close();
      }
    },
  };
}
