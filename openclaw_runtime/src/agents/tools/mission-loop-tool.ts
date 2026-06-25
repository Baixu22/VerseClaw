/**
 * mission_loop built-in tool.
 *
 * Lead-agent control surface for Mission Loop, the long-goal runtime primitive
 * above bounded task_loop ticks.
 */
import { Type } from "typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  getLatestMission,
  getMissionRun,
  runMission,
  tickMission,
  type MissionControllerDeps,
} from "../mission-control/controller.js";
import type { AnyAgentTool } from "./common.js";
import {
  jsonResult,
  readPositiveIntegerParam,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

type MissionLoopToolOptions = {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  config?: OpenClawConfig;
  deps?: MissionControllerDeps;
};

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readAction(params: Record<string, unknown>): "run" | "tick" | "status" {
  const raw = readStringParam(params, "action") ?? "run";
  if (raw === "run" || raw === "tick" || raw === "status") return raw;
  throw new ToolInputError('mission_loop action must be "run", "tick", or "status"');
}

function readMissionId(params: Record<string, unknown>): string | undefined {
  return readStringParam(params, "missionId") ?? readStringParam(params, "id");
}

export function createMissionLoopTool(opts?: MissionLoopToolOptions): AnyAgentTool {
  return {
    label: "Mission Loop",
    name: "mission_loop",
    displaySummary: "Run or inspect a long-goal Mission Loop.",
    description:
      "Run, tick, or inspect a controlled Mission Loop for long-running goals. Mission Loop rebuilds compact context, calls task_loop for each execution pulse, reviews evidence, checkpoints state, and stops as complete/blocked/ask_user/sleeping.",
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("run"), Type.Literal("tick"), Type.Literal("status")])),
      missionId: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      objective: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      workspaceId: Type.Optional(Type.String()),
      acceptance: Type.Optional(Type.Array(Type.String())),
      fileHints: Type.Optional(Type.Array(Type.String())),
      important: Type.Optional(Type.Boolean()),
      templateId: Type.Optional(Type.String()),
      teamTemplateId: Type.Optional(Type.String()),
      leadRole: Type.Optional(Type.String()),
      preferredLeadRole: Type.Optional(Type.String()),
      maxWorkers: Type.Optional(Type.Number()),
      includeVerifier: Type.Optional(Type.Boolean()),
      taskLedgerSummary: Type.Optional(Type.String()),
      memorySummary: Type.Optional(Type.String()),
      openBlockers: Type.Optional(Type.Array(Type.String())),
      reviewItems: Type.Optional(Type.Array(Type.String())),
      repairBrief: Type.Optional(Type.String()),
      enableSchedule: Type.Optional(Type.Boolean()),
      maxTicks: Type.Optional(Type.Number()),
      maxRepairTicks: Type.Optional(Type.Number()),
      reason: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
      const action = readAction(params);
      const sessionKey = opts?.agentSessionKey;
      const missionId = readMissionId(params);

      if (action === "status") {
        const record = missionId
          ? getMissionRun(missionId, opts?.deps)
          : sessionKey
            ? getLatestMission(sessionKey, opts?.deps)
            : null;
        if (!record) {
          throw new ToolInputError(missionId ? `unknown mission "${missionId}"` : "mission_loop status requires missionId or an agent session key");
        }
        return jsonResult(record);
      }

      if (action === "tick") {
        if (!missionId) throw new ToolInputError("mission_loop tick requires missionId");
        const mission = await tickMission(
          {
            missionId,
            reason: readStringParam(params, "reason") === "repair" ? "repair" : "manual",
            taskLedgerSummary: readStringParam(params, "taskLedgerSummary"),
            memorySummary: readStringParam(params, "memorySummary"),
            openBlockers: readStringArrayParam(params, "openBlockers"),
            reviewItems: readStringArrayParam(params, "reviewItems"),
            repairBrief: readStringParam(params, "repairBrief"),
          },
          opts?.config,
          opts?.deps,
        );
        return jsonResult({
          ...mission,
          resultPolicy: {
            completion: "mission_reviewer",
            nextAction: mission.status === "complete" ? "synthesize_final_response" : "checkpoint_or_continue",
          },
        });
      }

      const objective = readStringParam(params, "objective") ?? readStringParam(params, "task");
      if (!objective && !missionId) {
        throw new ToolInputError("mission_loop run requires objective or missionId");
      }
      if (!sessionKey && !missionId) {
        throw new ToolInputError("mission_loop requires an agent session key");
      }
      const mission = missionId && !objective
        ? await tickMission({ missionId, reason: "manual" }, opts?.config, opts?.deps)
        : await runMission(
            {
              ...(missionId ? { missionId } : {}),
              objective: objective ?? "",
              sessionKey: sessionKey ?? "",
              agentId: opts?.requesterAgentIdOverride,
              workspaceId: readStringParam(params, "workspaceId"),
              acceptance: readStringArrayParam(params, "acceptance"),
              fileHints: readStringArrayParam(params, "fileHints"),
              important: readBoolean(params.important) ?? false,
              templateId: readStringParam(params, "templateId"),
              teamTemplateId: readStringParam(params, "teamTemplateId"),
              leadRole: readStringParam(params, "leadRole"),
              preferredLeadRole: readStringParam(params, "preferredLeadRole"),
              maxWorkers: readPositiveIntegerParam(params, "maxWorkers"),
              includeVerifier: readBoolean(params.includeVerifier),
              taskLedgerSummary: readStringParam(params, "taskLedgerSummary"),
              memorySummary: readStringParam(params, "memorySummary"),
              openBlockers: readStringArrayParam(params, "openBlockers"),
              reviewItems: readStringArrayParam(params, "reviewItems"),
              repairBrief: readStringParam(params, "repairBrief"),
              enableSchedule: readBoolean(params.enableSchedule),
              maxTicks: readPositiveIntegerParam(params, "maxTicks"),
              maxRepairTicks: readPositiveIntegerParam(params, "maxRepairTicks"),
            },
            opts?.config,
            opts?.deps,
          );
      return jsonResult({
        ...mission,
        resultPolicy: {
          completion: "mission_reviewer",
          nextAction: mission.status === "complete" ? "synthesize_final_response" : "checkpoint_or_continue",
        },
      });
    },
  };
}
