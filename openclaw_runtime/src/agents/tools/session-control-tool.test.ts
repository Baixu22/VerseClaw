import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { filterToolsByPolicy } from "../agent-tools.policy.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import {
  canonicalToolName,
  createSessionControlTool,
  createSessionControlToolFromInventory,
  SESSION_CONTROL_ACTION_POLICY_NAMES,
  SESSION_CONTROL_TOOL_NAME,
} from "./session-control-tool.js";
import type { AnyAgentTool } from "./common.js";

vi.mock("../../config/sessions/goals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/sessions/goals.js")>();
  return {
    ...actual,
    createSessionGoal: vi.fn(async () => {
      throw new Error("goal already exists");
    }),
  };
});
vi.mock("../../config/sessions/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/sessions/store.js")>();
  return {
    ...actual,
    patchSessionEntry: vi.fn(async (params: { update: (entry: unknown) => unknown }) => {
      return params.update({});
    }),
  };
});
vi.mock("../../config/sessions/paths.js", () => ({
  resolveStorePath: vi.fn(() => "/mock/sessions.json"),
}));

function makeDelegate(name: string, details?: unknown): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} delegate`,
    parameters: Type.Object({}),
    execute: vi.fn(async (_id: string, params: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(params) }],
      details: details ?? { delegated: name, params },
    })),
  };
}

const ALL = [
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

function buildTool() {
  const delegates = {
    spawn: makeDelegate("sessions_spawn", { childSessionKey: "agent:main:child-1", status: "accepted" }),
    send: makeDelegate("sessions_send"),
    status: makeDelegate("session_status"),
    list: makeDelegate("sessions_list"),
    history: makeDelegate("sessions_history"),
    compact: makeDelegate("sessions_compact"),
    yieldTool: makeDelegate("sessions_yield"),
    subagents: makeDelegate("subagents"),
    goalGet: makeDelegate("get_goal"),
    goalCreate: makeDelegate("create_goal"),
    goalUpdate: makeDelegate("update_goal"),
  };
  return { delegates, tool: createSessionControlTool({ delegates }) };
}

async function run(tool: AnyAgentTool, params: Record<string, unknown>) {
  const result = await tool.execute("call-1", params);
  return { details: result.details as Record<string, unknown>, result };
}

describe("session_control tool", () => {
  it("routes each action to its legacy delegate with mapped params", async () => {
    const { delegates, tool } = buildTool();
    const cases: Array<[string, Record<string, unknown>, AnyAgentTool]> = [
      ["spawn", { task: "t", runtime: "acp" }, delegates.spawn],
      ["send", { message: "hi", sessionKey: "agent:main:other" }, delegates.send],
      ["status", { sessionKey: "current" }, delegates.status],
      ["list", { label: "x", limit: 5 }, delegates.list],
      ["history", { sessionKey: "agent:main:other", limit: 3 }, delegates.history],
      ["compact", { instructions: "keep decisions" }, delegates.compact],
      ["yield", { message: "waiting" }, delegates.yieldTool],
      ["subagents", { recentMinutes: 10 }, delegates.subagents],
    ];
    for (const [action, params, delegate] of cases) {
      await run(tool, { action, ...params });
      expect(delegate.execute).toHaveBeenCalled();
    }
    await run(tool, { action: "goal", op: "get" });
    expect(delegates.goalGet.execute).toHaveBeenCalledWith("call-1", {});
  });

  it("rejects unknown actions", async () => {
    const { tool } = buildTool();
    await expect(run(tool, { action: "nope" })).rejects.toThrow(/unknown session_control action/);
  });

  it("keeps model goal updates to complete|blocked", async () => {
    const { tool, delegates } = buildTool();
    await expect(run(tool, { action: "goal", op: "update", status: "start" })).rejects.toThrow(
      /must be "complete" or "blocked"/,
    );
    await run(tool, { action: "goal", op: "update", status: "blocked", note: "why" });
    expect(delegates.goalUpdate.execute).toHaveBeenCalledWith("call-1", {
      status: "blocked",
      note: "why",
    });
  });

  it("records spawn label and a non-overwriting goal error", async () => {
    const { tool } = buildTool();
    const { details } = await run(tool, {
      action: "spawn",
      task: "t",
      label: "  labeled child  ",
      goal: "build x",
    });
    expect(details).toMatchObject({
      childSessionKey: "agent:main:child-1",
      status: "accepted",
      label: { ok: true, label: "labeled child" },
      goal: { ok: false, error: "goal already exists" },
    });
  });

  it("fails closed when a required delegate is missing", () => {
    expect(
      createSessionControlToolFromInventory([makeDelegate("sessions_spawn")]),
    ).toBeNull();
  });

  it("canonicalizes legacy names to session_control", () => {
    expect(canonicalToolName("sessions_spawn")).toBe(SESSION_CONTROL_TOOL_NAME);
    expect(canonicalToolName("update_goal")).toBe(SESSION_CONTROL_TOOL_NAME);
    expect(canonicalToolName("exec")).toBe("exec");
    expect(SESSION_CONTROL_ACTION_POLICY_NAMES.goal).toBe("update_goal");
  });
});

describe("session_control assembly", () => {
  it("is absent by default and present when the experimental flag is on", () => {
    const off = createOpenClawTools({
      disablePluginTools: true,
      sessionId: "session-current",
      onManualCompactionRequest: () => "accepted",
      wrapBeforeToolCallHook: false,
    });
    expect(off.map((tool) => tool.name)).not.toContain(SESSION_CONTROL_TOOL_NAME);

    const on = createOpenClawTools({
      disablePluginTools: true,
      sessionId: "session-current",
      onManualCompactionRequest: () => "accepted",
      wrapBeforeToolCallHook: false,
      config: { tools: { experimental: { sessionControl: true } } },
    });
    expect(on.map((tool) => tool.name)).toContain(SESSION_CONTROL_TOOL_NAME);
    expect(on.map((tool) => tool.name)).toContain("sessions_spawn");
  });
});

describe("session_control policy narrowing", () => {
  it("keeps only actions whose policy names pass, enforcing leaf deny semantics", async () => {
    const { tool } = buildTool();
    const policy = {
      deny: [
        "sessions_spawn",
        "sessions_send",
        "sessions_list",
        "sessions_history",
        "session_status",
        "subagents",
      ],
    };
    const filtered = filterToolsByPolicy([tool], policy);
    expect(filtered).toHaveLength(1);
    const kept = filtered[0];
    expect(kept.sessionControlAllowedActionsRef?.current).toEqual(["compact", "yield", "goal"]);

    await expect(run(kept, { action: "spawn", task: "t" })).rejects.toThrow(/not allowed for this session/);
    await expect(run(kept, { action: "compact" })).resolves.toBeTruthy();
  });

  it("drops the tool when every action is denied", () => {
    const { tool } = buildTool();
    const filtered = filterToolsByPolicy([tool], {
      deny: [...Object.values(SESSION_CONTROL_ACTION_POLICY_NAMES)],
    });
    expect(filtered).toHaveLength(0);
  });
});