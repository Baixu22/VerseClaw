/**
 * `sessions.stop` handler contract: same error shape as other sessions.*
 * methods, no store/transcript mutation, and no mutation event emission.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const stopMocks = vi.hoisted(() => ({
  resolveRequestedGlobalAgentId: vi.fn(),
  resolveGatewaySessionTargetFromKey: vi.fn(),
  loadSessionsRuntimeModule: vi.fn(),
  stopSessionRuntime: vi.fn(),
  emitSessionsChanged: vi.fn(),
  loadSessionEntry: vi.fn(),
}));

vi.mock("./sessions.shared.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sessions.shared.js")>();
  return {
    ...original,
    resolveRequestedGlobalAgentId: stopMocks.resolveRequestedGlobalAgentId,
    resolveGatewaySessionTargetFromKey: stopMocks.resolveGatewaySessionTargetFromKey,
    loadSessionsRuntimeModule: stopMocks.loadSessionsRuntimeModule,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: stopMocks.loadSessionEntry,
  };
});

vi.mock("./session-change-event.js", () => ({
  emitSessionsChanged: stopMocks.emitSessionsChanged,
}));

import { sessionsRunControlHandlers } from "./sessions.run-control.js";

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

const context = {
  getRuntimeConfig: () => ({} as OpenClawConfig),
} as never;

describe("sessions.stop handler", () => {
  beforeEach(() => {
    stopMocks.resolveRequestedGlobalAgentId.mockReset();
    stopMocks.resolveGatewaySessionTargetFromKey.mockReset();
    stopMocks.loadSessionsRuntimeModule.mockReset();
    stopMocks.stopSessionRuntime.mockReset();
    stopMocks.emitSessionsChanged.mockReset();
    stopMocks.loadSessionEntry.mockReset();

    stopMocks.resolveRequestedGlobalAgentId.mockReturnValue({
      ok: true,
      agentId: "agent-a",
    });
    stopMocks.resolveGatewaySessionTargetFromKey.mockReturnValue({
      target: {
        agentId: "agent-a",
        storePath: "/tmp/sessions.json",
        canonicalKey: "agent:agent-a:main",
        storeKeys: ["agent:agent-a:main"],
      },
      storePath: "/tmp/sessions.json",
    });
    stopMocks.loadSessionEntry.mockReturnValue({
      entry: { sessionId: "session-1" },
      canonicalKey: "agent:agent-a:main",
    });
    stopMocks.loadSessionsRuntimeModule.mockResolvedValue({
      stopSessionRuntime: stopMocks.stopSessionRuntime,
    });
  });

  it("accepts key plus optional agentId and returns exactly { ok: true, key }", async () => {
    stopMocks.stopSessionRuntime.mockResolvedValue({
      ok: true,
      key: "agent:agent-a:main",
    });
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.stop"]!({
      params: { key: "agent:agent-a:main", agentId: "agent-a" },
      respond,
      context,
    } as never);

    expect(calls).toEqual([
      { ok: true, payload: { ok: true, key: "agent:agent-a:main" }, error: undefined },
    ]);
    expect(stopMocks.stopSessionRuntime).toHaveBeenCalledTimes(1);
    expect(stopMocks.stopSessionRuntime).toHaveBeenCalledWith({
      cfg: {},
      key: "agent:agent-a:main",
      target: expect.objectContaining({ canonicalKey: "agent:agent-a:main" }),
      entry: { sessionId: "session-1" },
      legacyKey: undefined,
      canonicalKey: "agent:agent-a:main",
    });
    expect(stopMocks.emitSessionsChanged).not.toHaveBeenCalled();
  });

  it("reuses errorShape for stop failures and emits no mutation event", async () => {
    const error = {
      code: "UNAVAILABLE",
      message: "Session agent:agent-a:main drain failed (timeout): late exit",
    };
    stopMocks.stopSessionRuntime.mockResolvedValue({ ok: false, error });
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.stop"]!({
      params: { key: "agent:agent-a:main" },
      respond,
      context,
    } as never);

    expect(calls).toEqual([{ ok: false, payload: undefined, error }]);
    expect(stopMocks.emitSessionsChanged).not.toHaveBeenCalled();
  });

  it("validates the stop params schema and rejects a missing key", async () => {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.stop"]!({
      params: {},
      respond,
      context,
    } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect(stopMocks.loadSessionsRuntimeModule).not.toHaveBeenCalled();
  });

  it("keeps sessions.abort as a distinct handler with its original semantics", async () => {
    expect(sessionsRunControlHandlers["sessions.abort"]).toBeTypeOf("function");
    expect(sessionsRunControlHandlers["sessions.abort"]).not.toBe(
      sessionsRunControlHandlers["sessions.stop"],
    );
  });
});
