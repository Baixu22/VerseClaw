/**
 * Regression tests for the gateway tool RPC forwarding boundary (issue #26).
 *
 * The gateway tool historically exposed only 6 config/control actions, leaving
 * fork/checkpoint-handoff/memory-write RPCs unreachable from the agent tool
 * surface. These tests pin the fail-closed shape of the forwarding allowlist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateSessionsForkParams } from "../../../packages/gateway-protocol/src/index.js";
import type { SessionsForkParams } from "../../../packages/gateway-protocol/src/schema/types.js";
import { resolveCoreOperatorGatewayMethodScope } from "../../gateway/methods/core-descriptors.js";
import { READ_SCOPE, WRITE_SCOPE } from "../../gateway/operator-scopes.js";
import type { MemoryProposal } from "../../memory/types.js";
import { createGatewayTool } from "./gateway-tool.js";

const callGatewayToolMock = vi.hoisted(() => vi.fn());

vi.mock("./gateway.js", () => ({
  callGatewayTool: callGatewayToolMock,
  readGatewayCallOptions: () => ({}),
}));

const GUARDED_ACTIONS = [
  "restart",
  "config.get",
  "config.schema.lookup",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

const FORWARD_ACTIONS = [
  "sessions.fork",
  "sessions.resumeCheckpoints",
  "sessions.checkpointDiff",
  "memory.propose",
  "memory.store",
  "memory.update",
] as const;

function readGatewayActionEnum(): string[] {
  const tool = createGatewayTool();
  const actionSchema = (tool.parameters as { properties: { action: { enum?: string[] } } })
    .properties.action;
  if (!actionSchema.enum) {
    throw new Error("gateway action enum missing");
  }
  return actionSchema.enum;
}

describe("gateway tool RPC forward allowlist", () => {
  it("exposes exactly the guarded and issue #26 forwarding actions", () => {
    expect(readGatewayActionEnum()).toEqual([...GUARDED_ACTIONS, ...FORWARD_ACTIONS]);
  });

  it("only contains read/write-scoped core gateway methods", () => {
    for (const action of FORWARD_ACTIONS) {
      const scope = resolveCoreOperatorGatewayMethodScope(action);
      expect([READ_SCOPE, WRITE_SCOPE], `${action} must stay read/write scoped`).toContain(scope);
    }
  });

  it("never overlaps the guarded config/update/restart actions", () => {
    const forwardSet = new Set<string>(FORWARD_ACTIONS);
    for (const guarded of GUARDED_ACTIONS) {
      expect(forwardSet.has(guarded), `${guarded} must not be forwardable`).toBe(false);
    }
  });

  it("does not expose admin-scoped or unknown methods", () => {
    const actions = readGatewayActionEnum();
    expect(actions).not.toContain("sessions.delete");
    expect(actions).not.toContain("sessions.restoreCheckpoint");
    expect(actions).not.toContain("not.a.method");
  });
});

describe("gateway tool RPC forwarding execute", () => {
  beforeEach(() => {
    callGatewayToolMock.mockReset();
  });

  it("forwards an allowlisted write RPC with parsed raw params", async () => {
    callGatewayToolMock.mockResolvedValue({ proposalId: "p-1" });
    const rpcParams = {
      proposal: {
        type: "fact",
        scope: "session",
        content: "remember me",
      },
    } satisfies { proposal: MemoryProposal };
    const tool = createGatewayTool();
    const result = await tool.execute("tool-call-1", {
      action: "memory.propose",
      raw: JSON.stringify(rpcParams),
    });
    expect(callGatewayToolMock).toHaveBeenCalledTimes(1);
    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "memory.propose",
      expect.anything(),
      rpcParams,
    );
    expect(result.details).toEqual({ ok: true, result: { proposalId: "p-1" } });
  });

  it("accepts JSON5-lenient raw params", async () => {
    callGatewayToolMock.mockResolvedValue({ ok: true });
    const rpcParams = {
      key: "agent:main:main",
      label: "fork-a",
    } satisfies SessionsForkParams;
    expect(validateSessionsForkParams(rpcParams)).toBe(true);
    const tool = createGatewayTool();
    await tool.execute("tool-call-2", {
      action: "sessions.fork",
      raw: "{key: 'agent:main:main', label: 'fork-a'}",
    });
    expect(callGatewayToolMock).toHaveBeenCalledWith("sessions.fork", expect.anything(), rpcParams);
  });

  it("forwards an empty params object when raw is omitted", async () => {
    callGatewayToolMock.mockResolvedValue({ checkpoints: [] });
    const tool = createGatewayTool();
    await tool.execute("tool-call-3", { action: "sessions.resumeCheckpoints" });
    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "sessions.resumeCheckpoints",
      expect.anything(),
      {},
    );
  });

  it("rejects non-object raw params before touching the gateway", async () => {
    const tool = createGatewayTool();
    await expect(
      tool.execute("tool-call-4", { action: "memory.store", raw: "[1,2]" }),
    ).rejects.toThrow(/raw must be a JSON object/);
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });

  it("still rejects methods outside the allowlist at runtime", async () => {
    const tool = createGatewayTool();
    await expect(
      tool.execute("tool-call-5", { action: "sessions.delete", raw: "{}" }),
    ).rejects.toThrow(/Unknown action: sessions\.delete/);
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });
});
