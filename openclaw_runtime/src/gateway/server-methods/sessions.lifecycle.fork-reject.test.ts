/**
 * Regression test for the sessions.fork too-large rejection contract (issue #27).
 *
 * When the parent exceeds the fork token ceiling, the gateway RPC must fail
 * closed with an honest, machine-detectable error: no child session, no
 * "isolated context" claim, structured reason/token details.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const forkMocks = vi.hoisted(() => ({
  resolveParentForkDecision: vi.fn(),
  forkSessionFromParent: vi.fn(),
}));

const loadSessionEntryMock = vi.hoisted(() => vi.fn());

vi.mock("../../auto-reply/reply/session-fork.js", () => ({
  resolveParentForkDecision: forkMocks.resolveParentForkDecision,
  forkSessionFromParent: forkMocks.forkSessionFromParent,
  formatParentForkFallbackNote: () => "unused-in-lifecycle",
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: loadSessionEntryMock,
  };
});

vi.mock("./session-active-runs.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./session-active-runs.js")>();
  return {
    ...original,
    isSessionBusyForManualCompaction: () => false,
  };
});

import { sessionsLifecycleHandlers } from "./sessions.lifecycle.js";

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

const context = {
  getRuntimeConfig: () => ({}) as OpenClawConfig,
} as never;

describe("sessions.fork parent-too-large rejection (issue #27)", () => {
  beforeEach(() => {
    forkMocks.resolveParentForkDecision.mockReset();
    forkMocks.forkSessionFromParent.mockReset();
    loadSessionEntryMock.mockReset();
    loadSessionEntryMock.mockReturnValue({
      entry: { sessionId: "parent-session-1" },
      canonicalKey: "agent:main:main",
      storePath: "/tmp/sessions.json",
    });
  });

  it("fails closed with an honest, structured error and creates nothing", async () => {
    forkMocks.resolveParentForkDecision.mockResolvedValue({
      status: "skip",
      reason: "parent-too-large",
      maxTokens: 100_000,
      parentTokens: 130_903,
      message: "Parent context is too large to fork (130903/100000 tokens).",
    });

    const { calls, respond } = makeRespond();
    await sessionsLifecycleHandlers["sessions.fork"]({
      params: { key: "agent:main:main" },
      respond,
      context,
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    const error = calls[0]!.error as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
    expect(error.code).toBe("INVALID_REQUEST");
    // Honest signaling: the caller must learn the fork was rejected, not that
    // some isolated session was silently started for them.
    expect(error.message).toContain("Parent context is too large to fork (130903/100000 tokens)");
    expect(error.message).toContain("No fork was created");
    expect(error.message).not.toMatch(/isolated context/i);
    // Machine-detectable degradation reason (issue #27 suggestion 1).
    expect(error.details).toEqual({
      reason: "parent-too-large",
      parentTokens: 130_903,
      maxTokens: 100_000,
    });
    expect(forkMocks.forkSessionFromParent).not.toHaveBeenCalled();
  });

  it("still forwards fork-eligible sessions to the fork runtime", async () => {
    forkMocks.resolveParentForkDecision.mockResolvedValue({
      status: "fork",
      maxTokens: 100_000,
      parentTokens: 42,
    });
    // Downstream store patching is out of scope here; failing the fork keeps
    // the handler on the early UNAVAILABLE path right after the decision.
    forkMocks.forkSessionFromParent.mockResolvedValue(null);

    const { calls, respond } = makeRespond();
    await sessionsLifecycleHandlers["sessions.fork"]({
      params: { key: "agent:main:main" },
      respond,
      context,
    } as never);

    expect(forkMocks.forkSessionFromParent).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    const error = calls[0]!.error as { code: string; message: string };
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.message).toContain("failed to fork source transcript");
  });
});
