/**
 * task_loop built-in tool.
 *
 * Runtime-owned controlled autonomy loop. It starts a bounded role-first
 * orchestration cycle, records self-check evidence, and returns the current
 * loop state to the lead agent for synthesis or follow-up.
 */
import { Type } from "typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  getTaskLoopRun,
  runTaskLoop,
  type TaskLoopControllerDeps,
} from "../task-loop-controller.js";
import type { AnyAgentTool } from "./common.js";
import {
  jsonResult,
  readPositiveIntegerParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

type TaskLoopToolOptions = {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  config?: OpenClawConfig;
  deps?: TaskLoopControllerDeps;
};

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
  );
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readAction(params: Record<string, unknown>): "run" | "status" {
  const raw = readStringParam(params, "action") ?? "run";
  if (raw === "run" || raw === "status") return raw;
  throw new ToolInputError('task_loop action must be "run" or "status"');
}

export function createTaskLoopTool(opts?: TaskLoopToolOptions): AnyAgentTool {
  return {
    label: "Task Loop",
    name: "task_loop",
    displaySummary: "Run a bounded self-checking task loop.",
    description:
      "Start or inspect a controlled runtime task loop with role-first subagents, self-check, and bounded repair. Use sessions_yield after accepted child work when results are pending.",
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("run"), Type.Literal("status")])),
      task: Type.Optional(Type.String()),
      loopRunId: Type.Optional(Type.String()),
      templateId: Type.Optional(Type.String()),
      teamTemplateId: Type.Optional(Type.String()),
      leadRole: Type.Optional(Type.String()),
      preferredLeadRole: Type.Optional(Type.String()),
      fileHints: Type.Optional(Type.Array(Type.String())),
      acceptance: Type.Optional(Type.Array(Type.String())),
      important: Type.Optional(Type.Boolean()),
      includeVerifier: Type.Optional(Type.Boolean()),
      maxWorkers: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
      const action = readAction(params);
      if (action === "status") {
        const loopRunId = readStringParam(params, "loopRunId", { required: true });
        const record = getTaskLoopRun(loopRunId);
        if (!record) {
          throw new ToolInputError(`unknown task loop "${loopRunId}"`);
        }
        return jsonResult(record);
      }

      const task = readStringParam(params, "task", { required: true });
      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        throw new ToolInputError("task_loop requires an agent session key");
      }
      const result = await runTaskLoop(
        {
          task,
          sessionKey,
          agentId: opts?.requesterAgentIdOverride,
          fileHints: readStringArray(params.fileHints),
          acceptance: readStringArray(params.acceptance),
          important: readBoolean(params.important) ?? false,
          includeVerifier: readBoolean(params.includeVerifier),
          templateId: readStringParam(params, "templateId"),
          teamTemplateId: readStringParam(params, "teamTemplateId"),
          leadRole: readStringParam(params, "leadRole"),
          preferredLeadRole: readStringParam(params, "preferredLeadRole"),
          maxWorkers: readPositiveIntegerParam(params, "maxWorkers"),
        },
        opts?.config,
        opts?.deps,
      );
      return jsonResult({
        ...result,
        resultPolicy: {
          completion: "task_loop_self_check",
          nextAction: result.status === "complete" ? "synthesize_final_response" : "yield_or_repair",
        },
      });
    },
  };
}
