/**
 * #178: the gateway `sessions.compactRange` handler resolves the located
 * boundary against the active transcript branch and then delegates to the single
 * `sessions.compact` path (so the validated pipeline + checkpoint are shared).
 * This covers the handler's own logic: fail-closed responses and the exact
 * params it hands to the delegate.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({ updateSessionStore: vi.fn() }));
const sessionUtilsMocks = vi.hoisted(() => ({
  resolveSessionTranscriptCandidates: vi.fn(),
  migrateAndPruneGatewaySessionStoreKey: vi.fn(),
}));
const transcriptMocks = vi.hoisted(() => ({ readTranscriptFileState: vi.fn() }));
const sharedMocks = vi.hoisted(() => ({
  requireSessionKey: vi.fn(),
  resolveRequestedGlobalAgentId: vi.fn(),
  resolveGatewaySessionTargetFromKey: vi.fn(),
}));

vi.mock("../../config/sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/sessions.js")>()),
  updateSessionStore: storeMocks.updateSessionStore,
}));
vi.mock("../session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-utils.js")>()),
  resolveSessionTranscriptCandidates: sessionUtilsMocks.resolveSessionTranscriptCandidates,
  migrateAndPruneGatewaySessionStoreKey: sessionUtilsMocks.migrateAndPruneGatewaySessionStoreKey,
}));
vi.mock("../../agents/embedded-agent-runner/transcript-file-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/embedded-agent-runner/transcript-file-state.js")>()),
  readTranscriptFileState: transcriptMocks.readTranscriptFileState,
}));
vi.mock("./sessions.shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessions.shared.js")>()),
  requireSessionKey: sharedMocks.requireSessionKey,
  resolveRequestedGlobalAgentId: sharedMocks.resolveRequestedGlobalAgentId,
  resolveGatewaySessionTargetFromKey: sharedMocks.resolveGatewaySessionTargetFromKey,
}));

import { sessionsCompactionHandlers } from "./sessions.compaction.js";

// `resolveSessionTranscriptCandidates(...).find(existsSync)` needs a real path.
const TRANSCRIPT_PATH = path.join(mkdtempSync(path.join(tmpdir(), "compact-range-handler-")), "session.jsonl");
writeFileSync(TRANSCRIPT_PATH, "");

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("#178 sessions.compactRange handler", () => {
  let delegate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedMocks.requireSessionKey.mockReturnValue("agent:main:main");
    sharedMocks.resolveRequestedGlobalAgentId.mockReturnValue({ ok: true, agentId: "main" });
    sharedMocks.resolveGatewaySessionTargetFromKey.mockReturnValue({
      target: { canonicalKey: "agent:main:main", agentId: "main" },
      storePath: "/tmp/sessions.json",
    });
    storeMocks.updateSessionStore.mockImplementation(async (_path, fn) =>
      fn({ "agent:main:main": { sessionId: "sess-1" } }));
    sessionUtilsMocks.migrateAndPruneGatewaySessionStoreKey.mockReturnValue({
      entry: { sessionId: "sess-1" },
      primaryKey: "agent:main:main",
    });
    sessionUtilsMocks.resolveSessionTranscriptCandidates.mockReturnValue([TRANSCRIPT_PATH]);
    delegate = vi.fn(async () => undefined);
    sessionsCompactionHandlers["sessions.compact"] = delegate as never;
  });

  function call(params: Record<string, unknown>) {
    const { calls, respond } = makeRespond();
    return {
      respond: () => sessionsCompactionHandlers["sessions.compactRange"]!({
        params,
        respond,
        context: { getRuntimeConfig: () => ({}) },
      } as never),
      calls,
    };
  }

  it("delegates a fromLeafId boundary as keepFromEntryId", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }, { id: "e2" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", fromLeafId: "e1" });
    await respond();
    expect(calls).toHaveLength(0);
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate.mock.calls[0]![0]).toMatchObject({
      params: { key: "agent:main:main", agentId: "main", keepFromEntryId: "e1" },
    });
  });

  it("resolves toLeafId to the next branch entry before delegating", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
    });
    const { respond } = call({ key: "agent:main:main", toLeafId: "e1" });
    await respond();
    expect(delegate.mock.calls[0]![0]).toMatchObject({
      params: { keepFromEntryId: "e2" },
    });
  });

  it("fails closed without delegating when the boundary is off-branch", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", fromLeafId: "ghost" });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect((calls[0]!.error as { code: string }).code).toBe("INVALID_REQUEST");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("fails closed when toLeafId is the transcript tail", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", toLeafId: "e1" });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect((calls[0]!.error as { details?: { reason?: string } }).details?.reason).toBe(
      "boundary-is-tail",
    );
    expect(delegate).not.toHaveBeenCalled();
  });

  it("rejects supplying both boundaries", async () => {
    const { respond, calls } = call({
      key: "agent:main:main",
      fromLeafId: "e1",
      toLeafId: "e2",
    });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });
});