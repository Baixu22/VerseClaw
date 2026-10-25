import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  loadEntry: vi.fn(),
  requestedAgent: vi.fn(),
  resolveTarget: vi.fn(),
  requireKey: vi.fn(),
}));

vi.mock("./session-archive-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-archive-service.js")>()),
  archiveSessionWithLifecycle: mocks.archive,
}));

vi.mock("./session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-utils.js")>()),
  loadSessionEntry: mocks.loadEntry,
}));

vi.mock("./server-methods/sessions.shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server-methods/sessions.shared.js")>()),
  resolveRequestedGlobalAgentId: mocks.requestedAgent,
  resolveGatewaySessionTargetFromKey: mocks.resolveTarget,
  requireSessionKey: mocks.requireKey,
}));

import { sessionsLifecycleHandlers } from "./server-methods/sessions.lifecycle.js";

const requestedKey = "agent:main:legacy-alias";
const canonicalKey = "agent:main:canonical";

function context() {
  return {
    getRuntimeConfig: () => ({}),
    getSessionEventSubscriberConnIds: () => new Set<string>(),
    broadcastToConnIds: vi.fn(),
    chatAbortControllers: new Map(),
  };
}

async function invokeArchive() {
  let response:
    | { ok: true; payload: unknown; error: undefined }
    | { ok: false; payload: undefined; error: Record<string, unknown> }
    | undefined;
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    response = ok
      ? { ok: true, payload, error: undefined }
      : { ok: false, payload: undefined, error: error as Record<string, unknown> };
  };
  await sessionsLifecycleHandlers["sessions.archive"]?.({
    params: { key: requestedKey, operationId: "operation-1" },
    respond,
    context: context(),
  } as never);
  if (!response) throw new Error("sessions.archive did not respond");
  return response;
}

beforeEach(() => {
  mocks.archive.mockReset();
  mocks.loadEntry.mockReset();
  mocks.requestedAgent.mockReset();
  mocks.resolveTarget.mockReset();
  mocks.requireKey.mockReset();
  mocks.requireKey.mockReturnValue(requestedKey);
  mocks.requestedAgent.mockReturnValue({ ok: true, agentId: "main" });
  mocks.loadEntry.mockReturnValue({ entry: undefined, canonicalKey });
  mocks.resolveTarget.mockReturnValue({
    target: {
      agentId: "main",
      storePath: "/tmp/session-store.json",
      canonicalKey,
      storeKeys: [canonicalKey],
      store: {},
    },
  });
});

describe("sessions.archive wire contract", () => {
  it("echoes the requested alias while retaining the runtime canonical key internally", async () => {
    mocks.archive.mockResolvedValue({
      ok: true,
      key: canonicalKey,
      operationId: "operation-1",
      journalState: "runtime_committed",
      archived: true,
      sessionId: "generation-1",
      archivedTranscriptPath: "/tmp/generation-1.archived.jsonl",
      archiveIndexPath: "/tmp/sessions.archives.json",
    });

    const response = await invokeArchive();
    expect(response).toMatchObject({
      ok: true,
      payload: {
        key: requestedKey,
        operationId: "operation-1",
        journalState: "runtime_committed",
      },
    });
  });

  it("places definitive refusals on the error channel with correlatable details", async () => {
    mocks.archive.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Session is not in the archive index",
      retryable: false,
      operationId: "operation-1",
      key: canonicalKey,
      noMutation: true,
    });

    const response = await invokeArchive();
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Session is not in the archive index",
        retryable: false,
        details: {
          kind: "lifecycle-mutation-failure",
          operationId: "operation-1",
          key: requestedKey,
          canonicalKey,
          noMutation: true,
        },
      },
    });
  });
});
