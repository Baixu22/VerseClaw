import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSessionEntry: vi.fn(),
  resolveGatewayScopedTools: vi.fn(),
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
}));

vi.mock("./tool-resolution.js", () => ({
  resolveGatewayScopedTools: mocks.resolveGatewayScopedTools,
}));

import { McpLoopbackToolCache } from "./mcp-http.runtime.js";

describe("McpLoopbackToolCache workspace scoping", () => {
  const cfg = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSessionEntry.mockReturnValue({ entry: { workspaceDir: "C:/project-a" } });
    mocks.resolveGatewayScopedTools.mockImplementation(({ workspaceDir }) => ({
      agentId: "main",
      tools: [
        {
          name: "workspace_probe",
          description: workspaceDir,
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
      ],
    }));
  });

  it("invalidates the short-lived cache when a session workspace changes", () => {
    const cache = new McpLoopbackToolCache();
    const params = {
      cfg,
      sessionKey: "agent:main:main",
      messageProvider: undefined,
      currentChannelId: undefined,
      currentThreadTs: undefined,
      currentMessageId: undefined,
      currentInboundAudio: undefined,
      accountId: undefined,
      inboundEventKind: undefined,
      sourceReplyDeliveryMode: undefined,
      senderIsOwner: true,
    };

    const first = cache.resolve(params);
    expect(first.tools).toHaveLength(1);
    expect(mocks.resolveGatewayScopedTools).toHaveBeenCalledTimes(1);

    mocks.loadSessionEntry.mockReturnValue({ entry: { workspaceDir: "C:/project-b" } });
    const second = cache.resolve(params);
    expect(second.tools).toHaveLength(1);
    expect(mocks.resolveGatewayScopedTools).toHaveBeenCalledTimes(2);
  });

  it("treats a spawned workspace as the cache scope over the persisted workspace", () => {
    const cache = new McpLoopbackToolCache();
    const params = {
      cfg,
      sessionKey: "agent:main:subagent:worker",
      messageProvider: undefined,
      currentChannelId: undefined,
      currentThreadTs: undefined,
      currentMessageId: undefined,
      currentInboundAudio: undefined,
      accountId: undefined,
      inboundEventKind: undefined,
      sourceReplyDeliveryMode: undefined,
      senderIsOwner: true,
    };

    mocks.loadSessionEntry.mockReturnValue({
      entry: {
        workspaceDir: "C:/project-a",
        spawnedWorkspaceDir: "C:/spawned-project",
      },
    });
    cache.resolve(params);
    expect(mocks.resolveGatewayScopedTools).toHaveBeenCalledTimes(1);

    // Changing only the lower-priority persisted value must not split the
    // cache key while the spawned workspace remains authoritative.
    mocks.loadSessionEntry.mockReturnValue({
      entry: {
        workspaceDir: "C:/project-b",
        spawnedWorkspaceDir: "C:/spawned-project",
      },
    });
    cache.resolve(params);
    expect(mocks.resolveGatewayScopedTools).toHaveBeenCalledTimes(1);

    mocks.loadSessionEntry.mockReturnValue({
      entry: {
        workspaceDir: "C:/project-b",
        spawnedWorkspaceDir: "C:/spawned-project-2",
      },
    });
    cache.resolve(params);
    expect(mocks.resolveGatewayScopedTools).toHaveBeenCalledTimes(2);
  });
});
