/**
 * #180: the gateway fork handler persists the fork point on the child session
 * entry (`forkedFromParent` + `parentSessionKey` + `forkedFromLeafId` +
 * `forkedFromTimestamp`). The runtime test proves the values exist and the
 * renderer E2E proves they render, but the handler copy itself was not covered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const forkMocks = vi.hoisted(() => ({
  resolveParentForkDecision: vi.fn(),
  forkSessionFromParent: vi.fn(),
}));
const loadSessionEntryMock = vi.hoisted(() => vi.fn());
const sessionUtilsMocks = vi.hoisted(() => ({ resolveGatewaySessionStoreTarget: vi.fn() }));
const sharedMocks = vi.hoisted(() => ({
  isSessionBusyForManualCompaction: vi.fn(() => false),
  buildDashboardSessionKey: vi.fn(() => "agent:main:dashboard-1"),
  inheritSessionRuntimeSelection: vi.fn(() => ({})),
}));
const patchMocks = vi.hoisted(() => ({ applySessionsPatchToStore: vi.fn() }));
const sessionsConfigMocks = vi.hoisted(() => ({ updateSessionStore: vi.fn() }));

vi.mock("../../auto-reply/reply/session-fork.js", () => ({
  resolveParentForkDecision: forkMocks.resolveParentForkDecision,
  forkSessionFromParent: forkMocks.forkSessionFromParent,
  formatParentForkFallbackNote: () => "unused",
}));
vi.mock("../session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-utils.js")>()),
  loadSessionEntry: loadSessionEntryMock,
  resolveGatewaySessionStoreTarget: sessionUtilsMocks.resolveGatewaySessionStoreTarget,
}));
vi.mock("./sessions.shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessions.shared.js")>()),
  isSessionBusyForManualCompaction: sharedMocks.isSessionBusyForManualCompaction,
  buildDashboardSessionKey: sharedMocks.buildDashboardSessionKey,
  inheritSessionRuntimeSelection: sharedMocks.inheritSessionRuntimeSelection,
}));
vi.mock("../sessions-patch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sessions-patch.js")>()),
  applySessionsPatchToStore: patchMocks.applySessionsPatchToStore,
}));
vi.mock("../../config/sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/sessions.js")>()),
  updateSessionStore: sessionsConfigMocks.updateSessionStore,
}));

import { sessionsLifecycleHandlers } from "./sessions.lifecycle.js";

const FORKED_FROM_TIMESTAMP = 1767225600000;

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("#180 sessions.fork lineage persistence", () => {
  let store: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {};
    loadSessionEntryMock.mockReturnValue({
      entry: { sessionId: "parent-sess" },
      canonicalKey: "agent:main:main",
      storePath: "/tmp/sessions.json",
    });
    forkMocks.resolveParentForkDecision.mockResolvedValue({
      status: "fork",
      maxTokens: 100_000,
      parentTokens: 42,
    });
    forkMocks.forkSessionFromParent.mockResolvedValue({
      sessionId: "child-sess",
      sessionFile: "/tmp/child.jsonl",
      forkedFromLeafId: "a1",
      forkedFromTimestamp: FORKED_FROM_TIMESTAMP,
    });
    sessionUtilsMocks.resolveGatewaySessionStoreTarget.mockReturnValue({
      storePath: "/tmp/sessions.json",
      canonicalKey: "agent:main:dashboard-1",
      agentId: "main",
    });
    patchMocks.applySessionsPatchToStore.mockResolvedValue({
      ok: true,
      entry: { label: "child label" },
    });
    sessionsConfigMocks.updateSessionStore.mockImplementation(
      async (_path: string, fn: (s: typeof store) => unknown) => fn(store),
    );
  });

  it("writes the fork point onto the child entry", async () => {
    const { calls, respond } = makeRespond();
    await sessionsLifecycleHandlers["sessions.fork"]!({
      params: { key: "agent:main:main", fromLeafId: "a1" },
      respond,
      context: {
        getRuntimeConfig: () => ({}),
        emit: () => undefined,
        getSessionEventSubscriberConnIds: () => new Set(),
      },
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(true);
    const child = store["agent:main:dashboard-1"];
    expect(child).toMatchObject({
      sessionId: "child-sess",
      sessionFile: "/tmp/child.jsonl",
      parentSessionKey: "agent:main:main",
      forkedFromParent: true,
      forkedFromLeafId: "a1",
      forkedFromTimestamp: FORKED_FROM_TIMESTAMP,
    });
  });

  it("omits the fork-point fields for a whole-session fork", async () => {
    forkMocks.forkSessionFromParent.mockResolvedValue({
      sessionId: "child-sess-2",
      sessionFile: "/tmp/child2.jsonl",
    });
    const { calls, respond } = makeRespond();
    await sessionsLifecycleHandlers["sessions.fork"]!({
      params: { key: "agent:main:main" },
      respond,
      context: {
        getRuntimeConfig: () => ({}),
        emit: () => undefined,
        getSessionEventSubscriberConnIds: () => new Set(),
      },
    } as never);

    expect(calls[0]!.ok).toBe(true);
    const child = store["agent:main:dashboard-1"];
    expect(child).toMatchObject({ parentSessionKey: "agent:main:main", forkedFromParent: true });
    expect(child).not.toHaveProperty("forkedFromLeafId");
    expect(child).not.toHaveProperty("forkedFromTimestamp");
  });
});