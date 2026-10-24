import { snapshotProcessSessionsForLifecycle } from "../agents/bash-process-registry.js";
import {
  snapshotDurableHelperPidsForSession,
} from "../agents/goal-wake-durable-cleanup.js";
import { resolveDurableHelperRoot } from "../agents/goal-wake-helper-protocol.js";
import { createWorktreeService } from "../agents/worktree-service.js";
import { captureProcessTrees } from "../process/os-containment.js";
import { readProcessTreeSample } from "../process/process-tree-sampler.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { sessionAdmissionRegistry, type SessionAdmissionIdentity } from "../sessions/session-admission-registry.js";
import { resolveConfigDir } from "../utils.js";
import type {
  LongSessionResourceInventory,
  SessionOwnerInventory,
} from "../../../shared/long-session-resource-reclamation.js";

export type RuntimeSessionResourceInventoryInput = {
  sessionKey: string;
  agentId?: string | null;
  expectedSessionId?: string | null;
  workspaceId?: string | null;
  rootPath?: string | null;
  agentWorkspaceDir?: string | null;
};

function uniquePids(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => (
    typeof value === "number" && Number.isInteger(value) && value > 0
  )))].sort((left, right) => left - right);
}

function identityFor(
  input: RuntimeSessionResourceInventoryInput,
): SessionAdmissionIdentity | null {
  const agentId = input.agentId?.trim() || parseAgentSessionKey(input.sessionKey)?.agentId?.trim();
  const expectedSessionId = input.expectedSessionId?.trim();
  if (!agentId || !expectedSessionId || !input.sessionKey.trim()) return null;
  return {
    agentId,
    canonicalSessionKey: input.sessionKey.trim(),
    expectedSessionId,
  };
}

function unknownOwner(params: {
  kind: SessionOwnerInventory["kind"];
  owner: string;
  generation: string | null;
  detail: string;
}): SessionOwnerInventory {
  return {
    kind: params.kind,
    owner: params.owner,
    authority: "unknown",
    generation: params.generation,
    state: "unknown",
    count: null,
    pids: null,
    processTreePids: null,
    rssKb: null,
    cpuPercent: null,
    activePermits: null,
    waiters: null,
    helperRefs: null,
    worktreeIds: null,
    sessionIds: null,
    detail: params.detail,
  };
}

/**
 * Read-only runtime half of the long-session resource ledger. The caller may
 * merge Main-owned terminals, browser sessions and managed ports; this module
 * never scans or owns those resources.
 */
export async function readRuntimeSessionResourceInventory(
  input: RuntimeSessionResourceInventoryInput,
): Promise<LongSessionResourceInventory> {
  const capturedAt = new Date().toISOString();
  const generation = input.expectedSessionId?.trim() || null;
  const worktreeRoot = input.rootPath?.trim() || input.agentWorkspaceDir?.trim();
  const identity = identityFor(input);
  if (!identity) {
    const detail = "runtime owner identity requires agentId, canonical session key and physical session generation";
    return {
      schema: "LongSessionResourceInventory/v1",
      scope: {
        workspaceId: input.workspaceId?.trim() || "",
        sessionKey: input.sessionKey.trim(),
        expectedSessionId: generation,
        rootPath: worktreeRoot || null,
      },
      capturedAt,
      owners: [
        unknownOwner({ kind: "process", owner: "ProcessSupervisor+BashProcessRegistry", generation, detail }),
        unknownOwner({ kind: "admission-permit", owner: "SessionAdmissionRegistry", generation, detail }),
        unknownOwner({ kind: "worktree", owner: "WorktreeService", generation, detail }),
      ],
    };
  }

  const supervisor = getProcessSupervisor();
  const supervisorRuns = supervisor.snapshotRunsForLifecycle(identity);
  const bashHandles = snapshotProcessSessionsForLifecycle(identity);
  const helperPids = await snapshotDurableHelperPidsForSession(
    identity.canonicalSessionKey,
    { rootDir: resolveDurableHelperRoot(resolveConfigDir()) },
  ).catch(() => null);
  const rootPids = uniquePids([
    ...supervisorRuns.map((run) => run.pid),
    ...bashHandles.map((handle) => handle.pid),
    ...(helperPids ?? []),
  ]);
  const [sample, treeCapture] = await Promise.all([
    rootPids.length > 0
      ? readProcessTreeSample({ rootPids })
      : Promise.resolve({
          status: "empty" as const,
          processCount: 0,
          treeRssBytes: 0,
          treeCpuPercent: 0,
        }),
    captureProcessTrees(rootPids),
  ]);
  const processKnown = sample.status !== "unknown" && helperPids !== null && treeCapture.status !== "unknown";
  const admission = sessionAdmissionRegistry.snapshot(identity);
  const worktrees = worktreeRoot
    ? createWorktreeService(worktreeRoot).listOwned({
      agentId: identity.agentId,
      sessionKey: identity.canonicalSessionKey,
      expectedSessionId: identity.expectedSessionId,
    })
    : null;

  const owners: SessionOwnerInventory[] = [
    {
      kind: "process",
      owner: "ProcessSupervisor+BashProcessRegistry",
      authority: "managed",
      generation,
      state: processKnown ? "known" : "unknown",
      count: rootPids.length,
      pids: rootPids,
      processTreePids: treeCapture.status === "ok" ? [...treeCapture.capturedPids.keys()].sort((a, b) => a - b) : null,
      rssKb: sample.treeRssBytes === null ? null : Math.ceil(sample.treeRssBytes / 1024),
      cpuPercent: sample.treeCpuPercent,
      activePermits: null,
      waiters: null,
      helperRefs: helperPids?.length ?? null,
      worktreeIds: null,
      sessionIds: null,
      ...(processKnown ? {} : { detail: "one or more runtime owner reads are unknown; zero is not inferred" }),
    },
    {
      kind: "admission-permit",
      owner: "SessionAdmissionRegistry",
      authority: "managed",
      generation,
      state: "known",
      count: admission?.active ?? 0,
      pids: null,
      processTreePids: null,
      rssKb: null,
      cpuPercent: null,
      activePermits: admission?.active ?? 0,
      waiters: admission?.waiters ?? 0,
      helperRefs: null,
      worktreeIds: null,
      sessionIds: null,
    },
    worktrees === null
      ? unknownOwner({
          kind: "worktree",
          owner: "WorktreeService",
          generation,
          detail: "workspace root was not available; worktree occupancy is unknown",
        })
      : {
          kind: "worktree",
          owner: "WorktreeService",
          authority: "managed",
          generation,
          state: "known",
          count: worktrees.length,
          pids: null,
          processTreePids: null,
          rssKb: null,
          cpuPercent: null,
          activePermits: null,
          waiters: null,
          helperRefs: null,
          worktreeIds: worktrees.map((record) => record.id),
          sessionIds: null,
        },
  ];

  return {
    schema: "LongSessionResourceInventory/v1",
    scope: {
      workspaceId: input.workspaceId?.trim() || "",
      sessionKey: identity.canonicalSessionKey,
      expectedSessionId: generation,
      rootPath: worktreeRoot || null,
    },
    capturedAt,
    owners,
  };
}