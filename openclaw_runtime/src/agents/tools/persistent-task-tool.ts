import { Type } from "typebox";
import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../../shared/task-system/identity.js";
import type {
  TaskCheckpoint,
  TaskContractInput,
  TaskCredential,
} from "../../../../shared/task-system/types.js";
import type { AnyAgentTool } from "./common.js";

/** Session identity comes from the runtime, never from model-authored arguments. */
export function createPersistentTaskTool(input: {
  workspace: string;
  sessionKey?: string;
  generation?: string;
}): AnyAgentTool {
  let pinned: TaskCredential | null = null;
  const initialDomain = resolveTaskDomain(input.workspace);
  if (existsSync(initialDomain.database) && input.sessionKey) {
    const initial = new TaskSystemStore(initialDomain);
    try {
      const view=initial.binding(input.sessionKey,input.generation);
      pinned = view?.referenceOnly?null:view?.claim??null;
    } finally {
      initial.close();
    }
  }
  return {
    name: "task_control",
    label: "Task control",
    risk: "write",
    description:
      "Persist an explicitly requested execution goal, identify existing tasks, claim before implementation, checkpoint progress, submit artifacts, and resume a paused task. Ordinary discussion does not create tasks. Use stable request IDs for retries. Task ownership does not grant tool permissions. Acceptance criteria must specify their verification kind; use owner-receipt for business checks. Never replace the goal with a status question.",
    parameters: Type.Object({
      action: Type.Union(
        [
          "list",
          "current",
          "create",
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
      requestId: Type.Optional(Type.String()),
      contract: Type.Optional(
        Type.Object({
          objective: Type.String({ maxLength: 3000 }),
          target: Type.String(),
          constraints: Type.Array(Type.String(), { maxItems: 30 }),
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
            Type.Object({ kind: Type.Literal("owner-receipt"), owner: Type.String(),requires:Type.Optional(Type.Array(Type.String())),files:Type.Optional(Type.Array(Type.String())) }),
              ]),
            }),
            { minItems: 1, maxItems: 20 },
          ),
          businessKey: Type.Optional(Type.String()),
          occurrenceKey: Type.Optional(Type.String()),
          dependencies: Type.Optional(Type.Array(Type.String())),
        }),
      ),
      checkpoint: Type.Optional(Type.Unknown()),
      candidate: Type.Optional(Type.String()),
      criterionId: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      sha256: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, raw) => {
      if (!input.sessionKey || !input.generation) throw new Error("TASK_SESSION_IDENTITY_REQUIRED");
      const p = raw as Record<string, unknown>;
      const domain = resolveTaskDomain(input.workspace);
      if (!existsSync(domain.database) && (p.action === "list" || p.action === "current"))
        return {
          content: [{ type: "text", text: p.action === "list" ? "[]" : "null" }],
          details: null,
        };
      const store = new TaskSystemStore(domain);
      try {
        const current = store.binding(input.sessionKey, input.generation);
        const str = (key: string) => {
          if (typeof p[key] !== "string" || !(p[key] as string).trim())
            throw new Error(`TASK_REQUIRED_${key}`);
          return p[key] as string;
        };
        let result: unknown;
        if(p.action==='accept'&&!current?.claim){
          const id=typeof p.taskNodeId==='string'?p.taskNodeId:pinned?.taskNodeId;
          if(!id)throw new Error('TASK_ID_REQUIRED_FOR_COMPLETION_REPLAY');
          const task=store.replayCompletedTask(id,input.sessionKey,input.generation,str('candidate'));
          return {content:[{type:'text',text:JSON.stringify(task)}],details:task};
        }
        if (p.action === "list") result = store.list();
        else if (p.action === "current") result = current;
        else if (p.action === "create")
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
          );
          const claimed = (result as { claim: TaskCredential }).claim;
          if (pinned && pinned.epoch !== claimed.epoch)
            throw new Error("TASK_RESTART_RUN_AFTER_HANDOFF");
          pinned = claimed;
        } else {
          if (!current?.claim||current.referenceOnly) throw new Error("TASK_CLAIM_REQUIRED");
          if (
            pinned &&
            (pinned.epoch !== current.claim.epoch || pinned.taskNodeId !== current.claim.taskNodeId)
          )
            throw new Error("TASK_STALE_OWNER");
          const c = pinned ?? current.claim;
          pinned = c;
          if (p.action === "checkpoint")
            result = store.checkpoint(c, p.checkpoint as TaskCheckpoint);
          else if (p.action === "resume") {
            result = store.handoff(c, input.sessionKey, input.generation);
            pinned = (result as { claim: TaskCredential }).claim;
          } else if (p.action === "pause" || p.action === "release" || p.action==='cancel') {
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
            const {acceptPersistentTask}=await import('../persistent-task-acceptance.js');
            result=acceptPersistentTask(store,c,str('candidate'));
          }
          else throw new Error("TASK_UNKNOWN_ACTION");
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } finally {
        store.close();
      }
    },
  };
}
