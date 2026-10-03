/**
 * goal_wait built-in tool.
 *
 * Phase 3 P0: only mission owner/lead top-level turns may call it. Mission,
 * session, and tick identity are bound from tool/runtime context; the model
 * can only select the single process dependency. Continuation is always the
 * fixed mission_tick effect owner.
 */
import { Type } from "typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { goalWakeController } from "../goal-wake-controller.js";
import { acquireSessionAdmissionPermit } from "../../sessions/session-admission-registry.js";
import type { AnyAgentTool } from "./common.js";
import {
  asToolParamsRecord,
  jsonResult,
  readPositiveIntegerParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

export type GoalWaitToolContext = {
  missionId: string;
  sessionKey: string;
  agentId?: string;
  tickId?: string;
  expectedRevision: number;
};

type GoalWaitToolOptions = {
  agentSessionKey?: string;
  runSessionKey?: string;
  agentId?: string;
  sessionId?: string;
  config?: OpenClawConfig;
  context?: GoalWaitToolContext;
  onYield?: (message: string) => Promise<void> | void;
};

const GoalWaitToolSchema = Type.Object({
  waitFor: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.Literal("process"),
        taskId: Type.String({ description: "Goal-owned process task id" }),
      }),
      { maxItems: 1 },
    ),
  ),
  taskId: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number({ minimum: 0 })),
  onTimeout: Type.Optional(Type.Union([Type.Literal("blocked"), Type.Literal("ask_user")])),
});

function readTaskId(params: Record<string, unknown>): string {
  const waitFor = params.waitFor;
  if (Array.isArray(waitFor)) {
    const entries = waitFor as Array<{ kind?: unknown; taskId?: unknown }>;
    if (entries.length === 0) throw new ToolInputError("goal_wait waitFor must contain one process dependency");
    const entry = entries[0];
    if (entry?.kind !== "process") {
      throw new ToolInputError("goal_wait P0 only supports waitFor[0].kind=\"process\"");
    }
    if (typeof entry.taskId === "string" && entry.taskId.trim()) {
      return entry.taskId.trim();
    }
    throw new ToolInputError("goal_wait waitFor[0].taskId is required");
  }
  const taskId = readStringParam(params, "taskId");
  if (!taskId) throw new ToolInputError("goal_wait requires waitFor[0].taskId or taskId");
  return taskId;
}

function resolveBoundContext(options: GoalWaitToolOptions): GoalWaitToolContext {
  if (options.context) {
    return options.context;
  }
  const sessionKey = options.runSessionKey?.trim() || options.agentSessionKey?.trim();
  if (!sessionKey) {
    throw new ToolInputError("goal_wait requires a bound mission run context");
  }
  const mission = goalWakeController.getLatestMissionForSession(sessionKey);
  if (!mission) {
    throw new ToolInputError("goal_wait is only available inside a mission run");
  }
  if (mission.status !== "running") {
    throw new ToolInputError(
      `goal_wait requires an active mission turn (mission ${mission.missionId} is ${mission.status})`,
    );
  }
  if (mission.agentId && options.agentId && mission.agentId !== options.agentId) {
    throw new ToolInputError("goal_wait is restricted to the mission owner/lead agent");
  }
  return {
    missionId: mission.missionId,
    sessionKey: mission.sessionKey,
    agentId: mission.agentId ?? options.agentId,
    ...(mission.activeTickId ? { tickId: mission.activeTickId } : {}),
    expectedRevision: mission.revision ?? 0,
  };
}

/** Creates the goal_wait tool. The runtime only registers it for bound turns. */
export function createGoalWaitTool(opts?: GoalWaitToolOptions): AnyAgentTool {
  return {
    label: "Goal Wait",
    name: "goal_wait",
    displaySummary: "Sleep the mission until a goal-owned process exits.",
    description:
      "Sleep the current mission turn until one goal-owned background process exits, then resume with a mission tick. Mission/session/tick identity comes from the active run context and cannot be overridden by the model.",
    risk: "write",
    writeRiskProfile: { kind: "dynamic_writes", requiresApproval: true },
    parameters: GoalWaitToolSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      if (!opts?.sessionId) {
        return jsonResult({ status: "error", error: "No session context" });
      }
      if (!opts?.onYield) {
        return jsonResult({ status: "error", error: "Yield not supported in this context" });
      }
      const context = resolveBoundContext(opts);
      const taskId = readTaskId(params);
      const task = goalWakeController.getGoalWaitTask(taskId);
      if (!task) {
        throw new ToolInputError(`unknown goal process task "${taskId}"`);
      }
      if (task.runtime !== "process") {
        throw new ToolInputError(`task "${taskId}" is not a process dependency`);
      }
      if (task.owner_key !== context.sessionKey) {
        throw new ToolInputError(`task "${taskId}" belongs to another session`);
      }
      if (
        task.status === "succeeded" ||
        task.status === "failed" ||
        task.status === "timed_out" ||
        task.status === "cancelled" ||
        task.status === "lost"
      ) {
        return jsonResult({
          status: "error",
          error: `task "${taskId}" is already ${task.status}; wake delivery will be handled by the level-check`,
        });
      }

      const release = acquireSessionAdmissionPermit(
        {
          agentId: context.agentId,
          canonicalSessionKey: context.sessionKey,
          expectedSessionId: opts.sessionId,
        },
        "goal-wake-arm",
      );
      try {
        const arm = await goalWakeController.armGoalWaitProcess(
          {
            missionId: context.missionId,
            sessionKey: context.sessionKey,
            agentId: context.agentId,
            expectedRevision: context.expectedRevision,
            ...(context.tickId ? { activeTickId: context.tickId } : {}),
            taskId,
            flowId: task.parent_flow_id ?? undefined,
            commandDigest: task.task,
            label: task.label ?? "goal-owned process",
            timeoutMs: readPositiveIntegerParam(params, "timeoutMs"),
          },
          opts.config,
        );
        if (!arm.ok) {
          return jsonResult({
            status: "error",
            error: `goal_wait arm failed: ${arm.reason}${arm.message ? ` (${arm.message})` : ""}`,
          });
        }
        const message = [
          `Goal wait armed: taskId=${arm.taskId} flowId=${arm.flowId}`,
          "The current turn will yield; the next mission tick is delivered when the process exits.",
        ].join("\n");
        await opts.onYield(message);
        return jsonResult({
          status: "yielded",
          message,
          taskId: arm.taskId,
          flowId: arm.flowId,
          turnBarrier: arm.turnBarrier,
        });
      } finally {
        release();
      }
    },
  };
}
