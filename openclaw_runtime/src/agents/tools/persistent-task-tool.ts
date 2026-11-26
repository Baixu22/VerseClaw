import { Type } from "typebox";
import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { canonicalPath } from "../../../../shared/task-system/identity.js";
import { SESSION_COLLABORATION_MATERIAL_KINDS } from "../../../../shared/types/session-collaboration-material.js";
import { assertSystemExecutionAllowed, readProjectCoordinator } from "../../../../shared/task-system/project-coordinator.js";
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
  maxRepairAttempts: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
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

const materialReferenceSchema = Type.Object({
  id: Type.String(), authorityId: Type.String(), taskNodeId: Type.String(), version: Type.Integer(),
  taskRevision: Type.Integer(), taskDigest: Type.String(), contentDigest: Type.String(),
}, { additionalProperties: false });

/** Session identity comes from the runtime, never from model-authored arguments. */
export function createPersistentTaskTool(input: {
  workspace: string;
  sessionKey?: string;
  generation?: string;
  runId?: string;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
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
      "For a project delivery loop, declare maxRepairAttempts (0 or 1) and an owner-receipt criterion with owner subagent-verifier and the files to review. Execute and test through the existing orchestration path, integrate its result, rerun affected checks, then submit a candidate. Use review with candidate and a stable requestId to dispatch the independent read-only reviewer, then sessions_yield for its completion notification. Accept only after it passes. If verification fails, use repair with candidate, reason and a stable requestId, fix within the same scope and remaining budget, rerun checks, submit a new candidate and obtain a fresh review. A second repair is refused. Report verified results, untested checks, residuals and next action from current/history; never infer done from prose. " +
      "When explicitly asked to execute the next project plan task, read planStatus, then use startNextPlanTask with the parent taskNodeId, expectedRevision and a stable requestId. This claims one dependency-ready task; worker admission is separate. " +
      "On an internal project worker failure notice, read planStatus. If the failed child is paused and its writer released, continue the next independent ready child using startNextPlanTask and a new stable requestId derived from the completed run. Leave the failed child and its dependents unaccepted; new work must still pass resource admission. " +
      "Manage execution tasks quietly in conversation. For explicit project planning requests in a project coordinator session, read planStatus and relevant project facts first, then use savePlan with goal contract, a bounded list of children with concrete verification, local dependsOn keys, and nextAction. Record uncertain facts as assumptions and unresolved major scope choices as decisions; scope those tasks to work that is safe under those uncertainties. Change an existing plan explicitly with taskNodeId, expectedRevision, and revisionReason; keep the requestId stable across retries and use a new ID for a new goal. Planning does not start execution. Before implementation, read current and use start with either taskNodeId or a complete contract to resolve and claim atomically. Derive goals and verifiable checks from the user request and repository; do not ask for task forms, internal IDs, or manual claims. Ordinary discussion creates no task. Report progress and genuine blockers plainly, checkpoint progress, and submit candidate-bound evidence for acceptance. Use stable request IDs across retries; suggestions do not grant identity. Use history to trace candidate checks and retention receipts; readRetainedArtifact returns verified bytes in bounded base64 pages after source cleanup. Task ownership does not grant tool permissions. Never replace the goal with a status question. " +
      "Use publishMaterial with a stable material.id to share findings from the current task. Cite original evidence and conditions for reuse. Use exact material references in supersedes or conflictsWith, or revokeMaterial with materialRef and a reason.",
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
          "publishMaterial",
          "revokeMaterial",
          "pause",
          "resume",
          "release",
          "cancel",
          "submit",
          "repair",
          "review",
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
      material: Type.Optional(Type.Object({
        id: Type.String({ minLength: 1, maxLength: 160 }),
        kind: Type.Union(SESSION_COLLABORATION_MATERIAL_KINDS.map(kind => Type.Literal(kind))),
        summary: Type.String({ minLength: 1, maxLength: 2048 }),
        evidenceRefs: Type.Array(Type.String({ maxLength: 160 }), { maxItems: 16 }),
        sensitivity: Type.Union([Type.Literal("internal"), Type.Literal("restricted")]),
        applicability: Type.Optional(Type.Array(Type.String({ maxLength: 300 }), { maxItems: 16 })),
        expiresAt: Type.Optional(Type.Integer({ minimum: 1 })),
        artifactRefs: Type.Optional(Type.Array(Type.Object({
          path: Type.String({ maxLength: 1024 }),
          sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        }, { additionalProperties: false }), { maxItems: 16 })),
        supersedes: Type.Optional(materialReferenceSchema),
        conflictsWith: Type.Optional(Type.Array(materialReferenceSchema, { minItems: 2, maxItems: 8 })),
      }, { additionalProperties: false })),
      materialRef: Type.Optional(materialReferenceSchema),
      candidate: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String({ maxLength: 2000 })),
      criterionId: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      sha256: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, raw, signal) => {
      if (!input.sessionKey || !input.generation) throw new Error("TASK_SESSION_IDENTITY_REQUIRED");
      const p = raw as Record<string, unknown>;
      const materialAction = p.action === 'publishMaterial' || p.action === 'revokeMaterial';
      if (materialAction || ['start', 'claim', 'startNextPlanTask', 'review', 'repair'].includes(String(p.action))) assertSystemExecutionAllowed();
      if (p.action === 'publishMaterial' && Object.keys(p).some(key => key !== 'action' && key !== 'material'))
        throw new Error('MATERIAL_INPUT_INVALID');
      if (p.action === 'revokeMaterial' && Object.keys(p).some(key => !['action', 'materialRef', 'reason'].includes(key)))
        throw new Error('MATERIAL_INPUT_INVALID');
      const planning = p.action === "planStatus" || p.action === "savePlan" || p.action === "startNextPlanTask";
      const scope = planning ? (() => {
        const ownerPath = process.env.CLAWX_WORKSPACE_OWNER_PATH;
        if (!ownerPath) throw new Error("TASK_PROJECT_COORDINATOR_REQUIRED");
        const entry = getSessionEntry({ sessionKey: input.sessionKey! });
        if (entry?.sessionId !== input.generation) throw new Error("TASK_GENERATION_STALE");
        return readProjectCoordinator(ownerPath, input.sessionKey!, input.generation!, input.workspace);
      })() : undefined;
      if (process.env.CLAWX_TASK_SCOPE_BRIDGE === '1' && !['list','current','status','changes','history','readRetainedArtifact','suggest'].includes(String(p.action))) {
        const session=getSessionEntry({sessionKey:input.sessionKey});
        if ((session as {executionMigration?:{state?:string}}|undefined)?.executionMigration?.state==='prepared')throw new Error('TASK_EXECUTION_MIGRATION_PENDING');
      }
      access.assertCurrent();
      const domain = access.domain;
      if (materialAction && !existsSync(domain.database)) throw new Error("TASK_CLAIM_REQUIRED");
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
          else if (materialAction) {
            const runId = input.runId;
            if (!runId) throw new Error("MATERIAL_SOURCE_RUN_MISSING");
            const [{ loadSessionEntry }, { sessionActivityOwnerScope }] = await Promise.all([
              import("../../gateway/session-utils.js"),
              import("../../gateway/server-methods/session-activity-read-model.js"),
            ]);
            const readSource = () => {
              signal?.throwIfAborted();
              const loaded = loadSessionEntry(c.sessionKey, { readOnly: true, skipCache: true });
              const source = sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry);
              const root = loaded.entry?.workspaceDir ?? loaded.entry?.spawnedWorkspaceDir;
              if (!source || loaded.legacyKey || !root || canonicalPath(root) !== domain.worktree)
                throw new Error("MATERIAL_SOURCE_SCOPE_MISMATCH");
              if (loaded.entry?.executionMigration?.state === "prepared") throw new Error("TASK_EXECUTION_MIGRATION_PENDING");
              return source;
            };
            result = p.action === "publishMaterial"
              ? store.publishSharedMaterial(c, p.material, runId, readSource)
              : store.revokeSharedMaterial(c, p.materialRef, p.reason, runId, readSource);
          } else if (p.action === "resume") {
            result = store.handoff(c, input.sessionKey, input.generation);
            pinned = (result as { claim: TaskCredential }).claim;
          } else if (p.action === "pause" || p.action === "release" || p.action === "cancel") {
            result = store.control(c, p.action);
            pinned = (result as { claim: TaskCredential }).claim;
          } else if (p.action === "submit") result = store.submit(c, str("candidate"));
          else if (p.action === "repair") result = store.repair(c, str("candidate"), str("requestId"), str("reason"));
          else if (p.action === "review") {
            const candidate = str("candidate");
            const parentTools = input.inheritedToolAllowlist;
            const denied = input.inheritedToolDenylist ?? [];
            if (!['sessions_spawn', 'team_orchestrate'].some(name =>
              (!parentTools || parentTools.includes(name)) && !denied.includes(name)))
              throw new Error('TASK_REVIEW_DELEGATION_NOT_ALLOWED');
            const readTools = ['read', 'glob', 'grep'].filter(name =>
              (!parentTools || parentTools.includes(name)) && !denied.includes(name));
            if (!readTools.includes('read')) throw new Error('TASK_REVIEW_READ_PERMISSION_REQUIRED');
            const [{ spawnRoleSubagent }, { spawnSubagentDirect }, { getRuntimeConfig }, { resolveOrchestrationContext }] = await Promise.all([
              import('../role-spawn.js'), import('../subagent-spawn.js'), import('../../config/config.js'),
              import('../orchestration-workspace-context.js'),
            ]);
            const cfg = getRuntimeConfig();
            const context = resolveOrchestrationContext({ sessionKey: c.sessionKey,
              expectedSessionGeneration: c.generation, workspaceDir: input.workspace }, () => cfg);
            const reservation = store.reserveReview(c, candidate, str("requestId"));
            if (reservation.replayed) result = { ...reservation.result, replayed: true };
            else {
              const submission = store.submission(c);
              const task = `Independently review this submitted project candidate. Read the listed files from disk, check the task criteria and report concrete findings. Do not modify files. Return verificationVerdict=pass|fail|repair_required.\n${JSON.stringify({
                contract: current.contract, candidate, artifacts: submission.artifacts,
              })}`;
              const admission = await spawnRoleSubagent({ role: 'reviewer', task, cfg, writeSet: [], agentId: context.requesterAgentIdOverride,
                orchestration: { orchestrationRunId: reservation.id, roleName: 'reviewer', isVerifier: true,
                  phase: 'verifier', leadRole: 'planner', originalTask: current.contract.objective,
                  verifierNoSelfRepair: true, taskNodeId: c.taskNodeId },
              }, { ...context, agentSessionKey: c.sessionKey, completionOwnerKey: c.sessionKey,
                reviewReservationId: reservation.id,
                workspaceDir: context.workspaceDir, assertWorkspaceCurrent: context.assertWorkspaceCurrent,
                inheritedToolAllowlist: readTools,
                inheritedToolDenylist: input.inheritedToolDenylist,
              }, { spawn: spawnSubagentDirect });
              const receipt = { status: admission.status, runId: admission.result?.runId,
                childSessionKey: admission.result?.childSessionKey, error: admission.error ?? admission.result?.error,
                dispatchOutcome: admission.result?.dispatchOutcome };
              store.recordReviewDispatch(c, reservation, receipt);
              result = receipt;
            }
          }
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
