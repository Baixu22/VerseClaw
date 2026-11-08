/**
 * B-3 v3: subagent-spawn write-set coordinate — the spawned-worker write-set is
 * normalized and persisted onto the child session entry (`spawnedWriteSet`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionStoreCacheForTest } from "../config/sessions/store.js";
import { closeSqliteSessionStoreDatabase, replaceSqliteSessionStore } from "../config/sessions/store-sqlite.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { loadSessionStore, updateSessionStore } from "./subagent-spawn.runtime.js";
import { spawnSubagentDirect, testing } from "./subagent-spawn.js";

afterEach(() => {
  testing.setDepsForTest();
  clearSessionStoreCacheForTest();
});

const { buildDirectChildSessionPatch } = testing;

describe("B-3 v3 buildDirectChildSessionPatch writeSet", () => {
  it("persists a normalized spawnedWriteSet when provided", () => {
    const patch = buildDirectChildSessionPatch({
      spawnedWriteSet: ["src/a.ts", " src/b.ts\\", "src/a.ts", "  "],
    });
    expect(patch.spawnedWriteSet).toEqual(["src/a.ts", "src/b.ts/"]);
  });

  it("omits spawnedWriteSet when absent or empty", () => {
    expect(buildDirectChildSessionPatch({}).spawnedWriteSet).toBeUndefined();
    expect(buildDirectChildSessionPatch({ spawnedWriteSet: [] }).spawnedWriteSet).toBeUndefined();
    expect(buildDirectChildSessionPatch({ spawnedWriteSet: undefined }).spawnedWriteSet).toBeUndefined();
  });

  it("keeps non-writeSet spawn metadata intact", () => {
    const patch = buildDirectChildSessionPatch({
      spawnedBy: "agent:parent:main",
      spawnedWorkspaceDir: "C:/repo",
      spawnedWriteSet: ["src/auth/middleware.ts"],
    });
    expect(patch.spawnedBy).toBe("agent:parent:main");
    expect(patch.spawnedWorkspaceDir).toBe("C:/repo");
    expect(patch.spawnedWriteSet).toEqual(["src/auth/middleware.ts"]);
  });

  it("rejects a parent reset during context preparation before dispatching the child", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "subagent-spawn-generation-"));
    const storePath = join(fixtureRoot, "sessions.json");
    const parentKey = "agent:main:parent";
    const parentEntry = {
      sessionId: "parent-generation-1",
      updatedAt: Date.now(),
      workspaceDir: fixtureRoot,
    };
    const dispatches: string[] = [];
    const rollback = vi.fn();
    replaceSqliteSessionStore(storePath, { [parentKey]: parentEntry });
    clearSessionStoreCacheForTest();

    const config = {
      session: { store: storePath },
      agents: { defaults: { subagents: { maxSpawnDepth: 4, maxChildrenPerAgent: 8 } } },
    } satisfies OpenClawConfig;
    const assertParentCurrent = () => {
      const current = loadSessionStore(storePath, { clone: false })[parentKey];
      if (current?.sessionId !== parentEntry.sessionId) {
        throw new Error("Parent workspace or session generation changed");
      }
    };

    testing.setDepsForTest({
      getRuntimeConfig: () => config,
      getGlobalHookRunner: () => null,
      hasInProcessGatewayContext: () => true,
      dispatchGatewayMethodInProcess: async <T>(method: string, params: Record<string, unknown>) => {
        dispatches.push(method);
        if (method === "agent") throw new Error("Child dispatched before generation check");
        if (method === "sessions.delete") {
          await updateSessionStore(storePath, (store) => { delete store[String(params.key)]; });
        }
        return {} as T;
      },
      ensureContextEnginesInitialized: () => undefined,
      resolveContextEngine: async () => ({
        info: { id: "generation-race", name: "Generation race fixture" },
        ingest: async () => ({ ingested: false }),
        assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
        compact: async () => ({ ok: true, compacted: false }),
        prepareSubagentSpawn: async () => {
          await updateSessionStore(storePath, (store) => {
            store[parentKey] = { ...parentEntry, sessionId: "parent-generation-2" };
          });
          clearSessionStoreCacheForTest();
          return { rollback };
        },
      }),
    });

    try {
      const result = await spawnSubagentDirect(
        { task: "spawn after preparation", context: "isolated" },
        { agentSessionKey: parentKey, assertWorkspaceCurrent: assertParentCurrent },
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/generation changed/);
      expect(dispatches).toContain("sessions.delete");
      expect(dispatches).not.toContain("agent");
      expect(rollback).toHaveBeenCalledOnce();
      const persisted = loadSessionStore(storePath, { clone: false });
      expect(persisted[parentKey]?.sessionId).toBe("parent-generation-2");
      expect(persisted[result.childSessionKey!]).toBeUndefined();
    } finally {
      closeSqliteSessionStoreDatabase(storePath);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
