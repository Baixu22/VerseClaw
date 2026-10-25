/**
 * Subagent child-session stop integration: the finalizer must reuse
 * `stopSubagentsForRequester` for recursive abort and then wait for every
 * aborted child's embedded run before drain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subagentMocks = vi.hoisted(() => ({
  listDescendantRunsForRequester: vi.fn(),
  stopSubagentsForRequester: vi.fn(),
  abortEmbeddedAgentRun: vi.fn(),
  resolveActiveEmbeddedRunSessionId: vi.fn(),
  waitForEmbeddedAgentRunEnd: vi.fn(),
}));

vi.mock("../agents/subagent-registry.js", () => ({
  listDescendantRunsForRequester: subagentMocks.listDescendantRunsForRequester,
}));

vi.mock("../auto-reply/reply/abort.js", () => ({
  stopSubagentsForRequester: subagentMocks.stopSubagentsForRequester,
}));

vi.mock("../agents/embedded-agent-runner/runs.js", () => ({
  abortEmbeddedAgentRun: subagentMocks.abortEmbeddedAgentRun,
  resolveActiveEmbeddedRunSessionId: subagentMocks.resolveActiveEmbeddedRunSessionId,
  waitForEmbeddedAgentRunEnd: subagentMocks.waitForEmbeddedAgentRunEnd,
}));

import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";
import { stopSessionRuntime } from "./session-reset-service.js";

const parentIdentity: SessionAdmissionIdentity = {
  agentId: "agent-a",
  canonicalSessionKey: "agent:agent-a:main",
  expectedSessionId: "parent-session-1",
};

const target = {
  agentId: parentIdentity.agentId,
  storePath: "/tmp/phase1-subagent-stop-store.json",
  canonicalKey: parentIdentity.canonicalSessionKey,
  storeKeys: [parentIdentity.canonicalSessionKey],
};

afterEach(() => {
  sessionAdmissionRegistry.clearForTests();
});

describe("stopSessionRuntime subagent child drain", () => {
  beforeEach(() => {
    subagentMocks.listDescendantRunsForRequester.mockReset();
    subagentMocks.stopSubagentsForRequester.mockReset();
    subagentMocks.abortEmbeddedAgentRun.mockReset();
    subagentMocks.resolveActiveEmbeddedRunSessionId.mockReset();
    subagentMocks.waitForEmbeddedAgentRunEnd.mockReset();

    subagentMocks.abortEmbeddedAgentRun.mockReturnValue(true);
    subagentMocks.waitForEmbeddedAgentRunEnd.mockResolvedValue(true);
    subagentMocks.stopSubagentsForRequester.mockReturnValue({ stopped: 1 });
    subagentMocks.listDescendantRunsForRequester.mockReturnValue([]);
  });

  it("recursively aborts children and waits for each active child run before drain", async () => {
    subagentMocks.listDescendantRunsForRequester.mockReturnValue([
      {
        runId: "child-run-1",
        childSessionKey: "agent:agent-a:subagent:child-1",
        requesterSessionKey: parentIdentity.canonicalSessionKey,
        createdAt: Date.now(),
        endedAt: undefined,
      },
    ] as never);
    subagentMocks.resolveActiveEmbeddedRunSessionId.mockReturnValue("child-session-1");

    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: parentIdentity.canonicalSessionKey,
      target,
      entry: {
        updatedAt: 1,
        sessionId: parentIdentity.expectedSessionId,
        sessionFile: "/tmp/phase1-subagent-stop-session.jsonl",
      },
    });

    expect(result.ok).toBe(true);
    expect(subagentMocks.abortEmbeddedAgentRun).toHaveBeenCalledWith("parent-session-1");
    expect(subagentMocks.stopSubagentsForRequester).toHaveBeenCalledWith({
      cfg: {},
      requesterSessionKey: parentIdentity.canonicalSessionKey,
    });
    expect(subagentMocks.waitForEmbeddedAgentRunEnd.mock.calls).toEqual([
      ["parent-session-1", 15_000],
      ["child-session-1", 15_000],
    ]);
    expect(sessionAdmissionRegistry.isFenced(parentIdentity)).toBe(false);
  });

  it("fails closed when an active child run id cannot be resolved for waiting", async () => {
    subagentMocks.listDescendantRunsForRequester.mockReturnValue([
      {
        runId: "child-run-2",
        childSessionKey: "agent:agent-a:subagent:child-2",
        requesterSessionKey: parentIdentity.canonicalSessionKey,
        createdAt: Date.now(),
        endedAt: undefined,
      },
    ] as never);
    subagentMocks.resolveActiveEmbeddedRunSessionId.mockReturnValue(undefined);

    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: parentIdentity.canonicalSessionKey,
      target,
      entry: {
        updatedAt: 1,
        sessionId: parentIdentity.expectedSessionId,
        sessionFile: "/tmp/phase1-subagent-stop-session.jsonl",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAVAILABLE");
      expect(result.error.message).toContain("Subagent child");
    }
    expect(sessionAdmissionRegistry.isFenced(parentIdentity)).toBe(false);
  });
});
