import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { loadSessionStore, updateSessionStore } from "../config/sessions.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { closeSqliteSessionStoreDatabase } from "../config/sessions/store-sqlite.js";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../shared/task-system/identity.js";
import { spawnSubagentDirect, testing } from "./subagent-spawn.js";
import { createSubagentRegistryLifecycleController } from "./subagent-registry-lifecycle.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } from "../config/config.js";

const mocks = vi.hoisted(() => ({ registered: vi.fn(),reserved:vi.fn(()=>true) }));
vi.mock("./subagent-registry.js", () => ({
  countActiveRunsForSession: () => 0,
  registerSubagentRun: mocks.registered,
  reserveSubagentRun:mocks.reserved,
  enqueueSubagentRun:vi.fn(),
  getSubagentRunByRunId:()=>null,
  releaseSubagentRun:vi.fn(),
}));
let root: string;
let store: TaskSystemStore;
let config: OpenClawConfig;
let sessionPath: string;
const saved = { state: process.env.OPENCLAW_STATE_DIR, config: process.env.OPENCLAW_CONFIG_PATH };
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "task-spawn-entry-"));
  sessionPath = join(root, "sessions.json");
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  config = {
    session: { store: sessionPath },
    agents: {
      defaults: { workspace: root, subagents: { maxSpawnDepth: 2, maxChildrenPerAgent: 3 } },
    },
  };
  setRuntimeConfigSnapshot(config);
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
  await updateSessionStore(sessionPath, (rows) => {
    rows["agent:main:main"] = { sessionId: "parent-generation", updatedAt: Date.now() };
  });
  store = new TaskSystemStore(resolveTaskDomain(root));
  const t = store.create(
    {
      objective: "Actual spawn preserves this task",
      target: ".",
      constraints: [],
      acceptance: [
        {
          id: "v",
          description: "verify",
          verification: { kind: "owner-receipt", owner: "fixture" },
        },
      ],
    },
    "create",
  ).task;
  store.claim(t.contract.taskNodeId, "agent:main:main", "parent-generation", "claim");
  mocks.registered.mockReset();
  mocks.reserved.mockClear();
});
afterEach(() => {
  testing.setDepsForTest();
  clearRuntimeConfigSnapshot();
  store.close();
  closeOpenClawStateDatabase();
  closeSqliteSessionStoreDatabase(sessionPath);
  if (saved.state === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = saved.state;
  if (saved.config === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
  else process.env.OPENCLAW_CONFIG_PATH = saved.config;
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("actual subagent spawn task admission", () => {
  it("commits the child identity before the Gateway agent callback and registers the same run", async () => {
    let dispatched = false;
    testing.setDepsForTest({
      getRuntimeConfig: () => config,
      getGlobalHookRunner: () => null,
      hasInProcessGatewayContext: () => false,
      callGateway: async (options) => {
        if (options.method === "agent") {
          const p = options.params as { sessionKey: string; idempotencyKey: string };
          const binding = store.binding(p.sessionKey);
          expect(binding?.claim?.sessionKey).toBe(p.sessionKey);
          expect(binding?.referenceOnly).not.toBe(true);
          expect(binding?.claim?.generation).toBe(
            loadSessionStore(sessionPath)[p.sessionKey]?.sessionId,
          );
          expect(store.delegationForChild(p.sessionKey)?.phase).toBe("prepared");
          dispatched = true;
          return { status: "accepted", runId: p.idempotencyKey } as never;
        }
        return { ok: true } as never;
      },
    });
    const result = await spawnSubagentDirect(
      {
        task: "Produce the result",
        lightContext: true,
        context: "isolated",
        cleanup: "keep",
        expectsCompletionMessage: false,
      },
      { workspaceDir: root, agentSessionKey: "agent:main:main" },
    );
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ status: "accepted" });
    expect(dispatched).toBe(true);
    expect(mocks.registered).toHaveBeenCalledOnce();
    expect(store.delegationForChild(result.childSessionKey!)?.phase).toBe("dispatched");
    expect(mocks.registered.mock.calls[0][0].runId).toBe(result.runId);
    const entry = {
      ...mocks.registered.mock.calls[0][0],
      createdAt: Date.now(),
    } as SubagentRunRecord;
    const persist = vi.fn();
    const controller = createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1000,
      persist,
      clearPendingLifecycleError: () => {},
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: async () => {},
      notifyContextEngineSubagentEnded: async () => {},
      resumeSubagentRun: () => {},
      callGateway: async () => ({}) as never,
      captureSubagentCompletionReply: async () => undefined,
      runSubagentAnnounceFlow: async () =>
        ({ delivered: true, path: "direct", phases: [] }) as never,
      warn: () => {},
    });
    await controller.completeSubagentRun({
      runId: entry.runId,
      endedAt: Date.now(),
      outcome: { status: "ok" },
      reason: "subagent-complete",
      triggerCleanup: false,
    });
    expect(persist).toHaveBeenCalled();
    expect(store.delegationForChild(entry.childSessionKey)?.phase).toBe("returned");
    expect(store.binding("agent:main:main")?.referenceOnly).not.toBe(true);
    controller.clearScheduledResumeTimers();
  });
  it("retains unknown ownership when the dispatch response and cleanup acknowledgement are both lost", async () => {
    testing.setDepsForTest({
      getRuntimeConfig: () => config,
      getGlobalHookRunner: () => null,
      hasInProcessGatewayContext: () => false,
      callGateway: async (options) => {
        if (options.method === "agent") throw new Error("lost acknowledgement");
        if (options.method === "sessions.delete") return { ok: true, deleted: false } as never;
        return { ok: true } as never;
      },
    });
    const result = await spawnSubagentDirect(
      {
        task: "Produce the result",
        lightContext: true,
        context: "isolated",
        expectsCompletionMessage: false,
      },
      { workspaceDir: root, agentSessionKey: "agent:main:main" },
    );
    expect(result.status).toBe("error");
    expect(mocks.registered).not.toHaveBeenCalled();
    expect(store.delegationForChild(result.childSessionKey!)?.phase).toBe("unknown");
    expect(store.binding("agent:main:main")?.referenceOnly).toBe(true);
  });
});
