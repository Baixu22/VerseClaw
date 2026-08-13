/**
 * session_control built-in tool.
 *
 * Consolidated session/task control surface. Each action delegates to the
 * existing single-purpose session/goal tools so behavior, policy, lock, and
 * delivery semantics stay identical. Enabled behind
 * `tools.experimental.sessionControl`; the legacy tool names remain executable
 * compatibility aliases and are mapped to the same policy names per action.
 */
import { Type } from "typebox";
import { createSessionGoal } from "../../config/sessions/goals.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { patchSessionEntry } from "../../config/sessions/store.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { parseSessionLabel } from "../../sessions/session-label.js";
import { stringEnum } from "../schema/typebox.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AnyAgentTool } from "./common.js";
import {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
  ToolAuthorizationError,
  ToolInputError,
} from "./common.js";

export const SESSION_CONTROL_TOOL_NAME = "session_control";

export const SESSION_CONTROL_ACTIONS = [
  "spawn",
  "send",
  "status",
  "list",
  "history",
  "compact",
  "yield",
  "goal",
  "subagents",
] as const;
export type SessionControlAction = (typeof SESSION_CONTROL_ACTIONS)[number];

/**
 * Maps each action to the legacy tool name that owns its policy semantics.
 * The most sensitive write op is used for `goal` so configured allow/deny
 * lists stay fail-closed.
 */
export const SESSION_CONTROL_ACTION_POLICY_NAMES: Readonly<
  Record<SessionControlAction, string>
> = {
  spawn: "sessions_spawn",
  send: "sessions_send",
  status: "session_status",
  list: "sessions_list",
  history: "sessions_history",
  compact: "sessions_compact",
  yield: "sessions_yield",
  goal: "update_goal",
  subagents: "subagents",
};

/** Legacy tool names treated as compatibility aliases of `session_control`. */
export const SESSION_CONTROL_LEGACY_ALIASES: Readonly<Record<string, SessionControlAction>> = {
  sessions_spawn: "spawn",
  sessions_send: "send",
  session_status: "status",
  sessions_list: "list",
  sessions_history: "history",
  sessions_compact: "compact",
  sessions_yield: "yield",
  subagents: "subagents",
  get_goal: "goal",
  create_goal: "goal",
  update_goal: "goal",
};

/** Resolve a legacy session/goal tool name to its canonical consolidated name. */
export function canonicalToolName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  return SESSION_CONTROL_LEGACY_ALIASES[normalized] ? SESSION_CONTROL_TOOL_NAME : normalized;
}

export type SessionControlDelegates = {
  spawn?: AnyAgentTool;
  send?: AnyAgentTool;
  status?: AnyAgentTool;
  list?: AnyAgentTool;
  history?: AnyAgentTool;
  compact?: AnyAgentTool;
  yieldTool?: AnyAgentTool;
  subagents?: AnyAgentTool;
  goalGet?: AnyAgentTool;
  goalCreate?: AnyAgentTool;
  goalUpdate?: AnyAgentTool;
};

export type SessionControlToolOptions = {
  delegates: SessionControlDelegates;
  allowedActions?: readonly SessionControlAction[];
  config?: OpenClawConfig;
};

function pickDefined(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "error";
}

async function applySpawnAnnotations(params: {
  childSessionKey?: string;
  label?: string;
  goal?: string;
  tokenBudget?: number;
  config?: OpenClawConfig;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!params.childSessionKey) {
    if (params.label || params.goal) {
      out.annotationError = "child session key unavailable";
    }
    return out;
  }
  const parsed = parseAgentSessionKey(params.childSessionKey);
  const agentId = normalizeAgentId(parsed?.agentId ?? "");
  const storePath = resolveStorePath(params.config?.session?.store, { agentId });

  if (params.label !== undefined) {
    const parsedLabel = parseSessionLabel(params.label);
    if (!parsedLabel.ok) {
      out.label = { ok: false, error: parsedLabel.error };
    } else {
      try {
        await patchSessionEntry({
          sessionKey: params.childSessionKey,
          storePath,
          update: (entry) => (entry.label?.trim() ? null : { label: parsedLabel.label }),
        });
        out.label = { ok: true, label: parsedLabel.label };
      } catch (error) {
        out.label = { ok: false, error: messageOf(error) };
      }
    }
  }

  if (params.goal !== undefined) {
    try {
      const goal = await createSessionGoal({
        sessionKey: params.childSessionKey,
        storePath,
        objective: params.goal,
        ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
      });
      out.goal = { ok: true, goal };
    } catch (error) {
      out.goal = { ok: false, error: messageOf(error) };
    }
  }
  return out;
}

/**
 * Build the consolidated `session_control` tool from the single-purpose
 * delegates already assembled for the current run.
 */
export function createSessionControlTool(options: SessionControlToolOptions): AnyAgentTool {
  const allowedRef: { current: readonly SessionControlAction[] } = {
    current: options.allowedActions ?? SESSION_CONTROL_ACTIONS,
  };

  const delegate = async (
    tool: AnyAgentTool | undefined,
    toolCallId: string,
    params: unknown,
  ): Promise<ReturnType<AnyAgentTool["execute"]>> => {
    if (!tool) {
      return jsonResult({ status: "error", error: "delegate tool unavailable" });
    }
    return tool.execute(toolCallId, params);
  };

  return {
    name: SESSION_CONTROL_TOOL_NAME,
    label: "Session Control",
    displaySummary: "Control sessions, goals, and subagents in one surface",
    description: [
      "Consolidated session/task control tool (preferred surface).",
      "Actions:",
      "- spawn: start a new subagent/ACP session (task, runtime, mode, context, agentId, label, goal).",
      "- send: send a message to a visible session or configured agent (sessionKey/label/agentId, message).",
      "- status: current session card (model, usage, tasks) or a named session card.",
      "- list: list visible sessions (label/agentId/search/limit).",
      "- history: fetch sanitized history for a session (sessionKey, limit, includeTools).",
      "- compact: request compaction of the current session (instructions).",
      "- yield: end the turn and wait for spawned subagent completion events (message).",
      "- goal: get/create/update the session goal (op, objective, status, note, token_budget).",
      "- subagents: list active/recent subagents controlled by this session (recentMinutes).",
      "Goal status is model-updatable only to complete|blocked; start/pause/resume/clear stay user-only.",
      "After spawning children do not poll; use yield and wait for pushed completion events.",
    ].join("\n"),
    parameters: Type.Object({
      action: stringEnum(SESSION_CONTROL_ACTIONS, {
        description: "Which session/task control operation to run.",
      }),
      sessionKey: Type.Optional(Type.String({ description: "Session key; omit or 'current' for current session." })),
      label: Type.Optional(Type.String({ description: "Session label to target or set on spawn." })),
      agentId: Type.Optional(Type.String({ description: "Configured agent id to target." })),
      message: Type.Optional(Type.String({ description: "Message text for send/yield." })),
      task: Type.Optional(Type.String({ description: "Required task description for spawn." })),
      runtime: Type.Optional(stringEnum(["subagent", "acp"], { description: "Spawn runtime; default subagent." })),
      mode: Type.Optional(stringEnum(["run", "session"], { description: "run=one-shot, session=persistent." })),
      context: Type.Optional(stringEnum(["isolated", "fork"], { description: "Child context; default isolated." })),
      goal: Type.Optional(Type.String({ description: "Initial goal objective written on a spawned child session." })),
      objective: Type.Optional(Type.String({ description: "Goal objective for goal.create." })),
      status: Type.Optional(stringEnum(["complete", "blocked"], { description: "Goal status for goal.update." })),
      note: Type.Optional(Type.String({ description: "Short status note for goal.update." })),
      token_budget: Type.Optional(Type.Number({ description: "Optional positive token budget for a new goal." })),
      instructions: Type.Optional(Type.String({ description: "Compaction instructions." })),
      customInstructions: Type.Optional(Type.String({ description: "Compaction custom instructions." })),
      limit: Type.Optional(Type.Number({ description: "Result limit for list/history." })),
      includeTools: Type.Optional(Type.Boolean({ description: "Include tool messages in history." })),
      search: Type.Optional(Type.String({ description: "Search filter for list." })),
      recentMinutes: Type.Optional(Type.Number({ description: "Window for subagents list." })),
      timeoutSeconds: Type.Optional(Type.Number({ description: "Optional wait timeout for send." })),
      op: Type.Optional(stringEnum(["get", "create", "update"], { description: "Goal operation." })),
    }),
    sessionControlActions: SESSION_CONTROL_ACTIONS,
    sessionControlActionPolicyNames: SESSION_CONTROL_ACTION_POLICY_NAMES,
    sessionControlAllowedActionsRef: allowedRef,
    execute: async (toolCallId, params, _signal, _onUpdate) => {
      const raw = asToolParamsRecord(params);
      const action = readStringParam(raw, "action", { required: true }) as SessionControlAction;
      if (!SESSION_CONTROL_ACTIONS.includes(action)) {
        throw new ToolInputError(`unknown session_control action "${action}"`);
      }
      if (!allowedRef.current.includes(action)) {
        throw new ToolAuthorizationError(
          `session_control action "${action}" is not allowed for this session`,
        );
      }

      switch (action) {
        case "spawn": {
          const task = readStringParam(raw, "task", { required: true });
          const spawnParams = pickDefined(raw, ["runtime", "mode", "context", "agentId"]);
          spawnParams.task = task;
          const result = await delegate(options.delegates.spawn, toolCallId, spawnParams);
          const details =
            result.details && typeof result.details === "object"
              ? (result.details as Record<string, unknown>)
              : {};
          const childSessionKey =
            typeof details.childSessionKey === "string" ? details.childSessionKey : undefined;
          const annotations = await applySpawnAnnotations({
            childSessionKey,
            label: readStringParam(raw, "label"),
            goal: readStringParam(raw, "goal"),
            tokenBudget: readNumberParam(raw, "token_budget", { integer: true }),
            config: options.config,
          });
          if (Object.keys(annotations).length === 0) {
            return result;
          }
          return jsonResult({ ...details, ...annotations });
        }
        case "send": {
          const message = readStringParam(raw, "message", { required: true });
          const sendParams = pickDefined(raw, ["sessionKey", "label", "agentId", "timeoutSeconds"]);
          sendParams.message = message;
          return delegate(options.delegates.send, toolCallId, sendParams);
        }
        case "status": {
          const statusParams = pickDefined(raw, ["sessionKey"]);
          return delegate(options.delegates.status, toolCallId, statusParams);
        }
        case "list": {
          const listParams = pickDefined(raw, ["label", "agentId", "search", "limit"]);
          return delegate(options.delegates.list, toolCallId, listParams);
        }
        case "history": {
          const historyParams = pickDefined(raw, ["sessionKey", "limit"]);
          const includeTools = typeof raw.includeTools === "boolean" ? raw.includeTools : undefined;
          if (includeTools !== undefined) {
            historyParams.includeTools = includeTools;
          }
          return delegate(options.delegates.history, toolCallId, historyParams);
        }
        case "compact": {
          const compactParams = pickDefined(raw, ["customInstructions"]);
          const instructions = readStringParam(raw, "instructions");
          if (instructions !== undefined) {
            compactParams.customInstructions = instructions;
          }
          return delegate(options.delegates.compact, toolCallId, compactParams);
        }
        case "yield": {
          return delegate(options.delegates.yieldTool, toolCallId, pickDefined(raw, ["message"]));
        }
        case "goal": {
          const op = readStringParam(raw, "op") ?? "get";
          if (op === "get") {
            return delegate(options.delegates.goalGet, toolCallId, {});
          }
          if (op === "create") {
            const objective = readStringParam(raw, "objective", { required: true });
            const createParams: Record<string, unknown> = { objective };
            const tokenBudget = readNumberParam(raw, "token_budget", { integer: true });
            if (tokenBudget !== undefined) {
              createParams.token_budget = tokenBudget;
            }
            return delegate(options.delegates.goalCreate, toolCallId, createParams);
          }
          if (op === "update") {
            const status = readStringParam(raw, "status", { required: true });
            if (status !== "complete" && status !== "blocked") {
              throw new ToolInputError(
                'session_control goal.update status must be "complete" or "blocked"',
              );
            }
            const updateParams: Record<string, unknown> = { status };
            const note = readStringParam(raw, "note");
            if (note !== undefined) {
              updateParams.note = note;
            }
            return delegate(options.delegates.goalUpdate, toolCallId, updateParams);
          }
          throw new ToolInputError(`unknown session_control goal op "${op}"`);
        }
        case "subagents": {
          return delegate(options.delegates.subagents, toolCallId, pickDefined(raw, ["recentMinutes"]));
        }
        default:
          throw new ToolInputError(`unsupported session_control action "${action}"`);
      }
    },
  };
}

/** Find the legacy delegates inside an assembled tool inventory and wrap them. */
export function createSessionControlToolFromInventory(
  tools: readonly AnyAgentTool[],
  config?: OpenClawConfig,
): AnyAgentTool | null {
  const find = (name: string): AnyAgentTool | undefined =>
    tools.find((tool) => tool.name === name);
  const delegates: SessionControlDelegates = {
    spawn: find("sessions_spawn"),
    send: find("sessions_send"),
    status: find("session_status"),
    list: find("sessions_list"),
    history: find("sessions_history"),
    compact: find("sessions_compact"),
    yieldTool: find("sessions_yield"),
    subagents: find("subagents"),
    goalGet: find("get_goal"),
    goalCreate: find("create_goal"),
    goalUpdate: find("update_goal"),
  };
  const required: Array<[string, AnyAgentTool | undefined]> = Object.entries(delegates);
  if (required.some(([, tool]) => !tool)) {
    return null;
  }
  return createSessionControlTool({ delegates, config });
}