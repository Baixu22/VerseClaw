import { snapshotProcessSessionsForLifecycle } from "../agents/bash-process-registry.js";
import {
  snapshotDurableHelperPidsForSession,
} from "../agents/goal-wake-durable-cleanup.js";
import { resolveDurableHelperRoot } from "../agents/goal-wake-helper-protocol.js";
import { createWorktreeService } from "../agents/worktree-service.js";
import { observeWorktree } from "../agents/worktree-registry.js";
import { captureProcessTrees } from "../process/os-containment.js";
import { ProcessTreeSampler, readProcessTreeSample } from "../process/process-tree-sampler.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { sessionAdmissionRegistry, type SessionAdmissionIdentity } from "../sessions/session-admission-registry.js";
import { resolveConfigDir } from "../utils.js";
import { getRuntimeConfig } from '../config/config.js';
import { resolveProjectIdForWorkspace, type WorkspaceId, type SessionKey } from '../../../shared/types/identity-scope.js';
import type {
  LongSessionResourceInventory,
  SessionOwnerInventory,
} from "../../../shared/long-session-resource-reclamation.js";
import { projectCollaborationProcessSample } from "../../../shared/types/session-collaboration-resources.js";

export type RuntimeSessionResourceInventoryInput = {
  sessionKey: string;
  agentId?: string | null;
  expectedSessionId?: string | null;
  workspaceId?: string | null;
  rootPath?: string | null;
  agentWorkspaceDir?: string | null;
  scopedRead?: boolean;
};

const collaborationSampler = new ProcessTreeSampler();

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
  const runtimeConfig = getRuntimeConfig();
  const providerPolicy = runtimeConfig.runtime?.providerBudget;
  const providerEnabled = providerPolicy && Object.values(providerPolicy).some(limits => limits && (limits.maxTokens !== undefined || limits.maxCostUsd !== undefined));
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
        ...(providerEnabled ? [unknownOwner({ kind: 'provider', owner: 'ProviderOutboundBudget', generation, detail })] : []),
      ],
    };
  }

  const supervisor = getProcessSupervisor();
  const handles = () => {
    const runs = supervisor.snapshotRunsForLifecycle(identity);
    const bash = snapshotProcessSessionsForLifecycle(identity);
    return { runs, bash, signature: JSON.stringify([
      ...runs.map(run => ['supervisor', run.runId, run.pid, run.creationToken, run.rootActive]),
      ...bash.filter(handle => handle.pid).map(handle => ['bash', handle.id, handle.pid]),
    ].sort()) };
  };
  const before = handles();
  const ownedRoots = new Map(before.runs.flatMap(run => run.rootActive && run.pid && run.creationToken
    ? [[run.pid, run.creationToken] as const] : []));
  const helperPids = input.scopedRead ? null : await snapshotDurableHelperPidsForSession(
    identity.canonicalSessionKey,
    { rootDir: resolveDurableHelperRoot(resolveConfigDir()) },
  ).catch(() => null);
  const rootPids = uniquePids([
    ...before.runs.map((run) => run.pid),
    ...before.bash.map((handle) => handle.pid),
    ...(helperPids ?? []),
  ]);
  const [treeCapture, sample] = input.scopedRead
    ? [await captureProcessTrees(rootPids), await collaborationSampler.sample({ rootPids })]
    : await Promise.all([captureProcessTrees(rootPids), readProcessTreeSample({ rootPids })]);
  const scopedProcess = input.scopedRead ? projectCollaborationProcessSample({ sample, roots: rootPids,
    ownedRoots,
    captured: treeCapture.status === 'ok' ? treeCapture.capturedPids : null,
    handlesStable: before.signature === handles().signature && before.runs.every(run => Boolean(run.pid) && run.rootActive === true) &&
      before.bash.every(handle => !handle.pid ? !handle.lifecycleOwner : before.runs.some(run =>
        run.runId === handle.id && run.pid === handle.pid && run.rootActive === true)), now: Date.now() }) : null;
  const processKnown = (scopedProcess ? scopedProcess.state === 'known' :
    sample.status !== "unknown" && helperPids !== null && treeCapture.status !== "unknown");
  const admission = sessionAdmissionRegistry.snapshot(identity);
  let worktrees: ReturnType<ReturnType<typeof createWorktreeService>["listOwned"]> | null = null;
  let worktreesKnown = false;
  let worktreeReadError: string | undefined;
  try {
    if (worktreeRoot) {
      worktrees = createWorktreeService(worktreeRoot).listOwned({
        agentId: identity.agentId, sessionKey: identity.canonicalSessionKey,
        expectedSessionId: identity.expectedSessionId,
      }, input.scopedRead);
      worktreesKnown = worktrees.every(record => observeWorktree(record) === "ready");
    }
  } catch (error) {
    worktrees = null;
    worktreeReadError = `workspace root ownership read failed: ${(error as NodeJS.ErrnoException).code ?? 'unavailable'}`;
  }

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
      cpuPercent: !input.scopedRead && !rootPids.length ? 0 : sample.treeCpuPercent,
      activePermits: null,
      waiters: null,
      helperRefs: helperPids?.length ?? null,
      worktreeIds: null,
      sessionIds: null,
      ...(scopedProcess ?? {}),
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
      ...(input.scopedRead ? { admission: { fenced: admission?.fenced ?? false,
        rejectedWhileFenced: admission?.totalRejectedWhileFenced ?? null }, sampledAt: Date.now() } : {}),
      helperRefs: null,
      worktreeIds: null,
      sessionIds: null,
    },
    worktrees === null
      ? unknownOwner({
          kind: "worktree",
          owner: "WorktreeService",
          generation,
          detail: worktreeReadError ?? "workspace root was not available; worktree occupancy is unknown",
        })
      : {
          kind: "worktree",
          owner: "WorktreeService",
          authority: "managed",
          generation,
          state: worktreesKnown ? "known" : "unknown",
          count: input.scopedRead && !worktreesKnown ? null : worktrees.length,
          pids: null,
          processTreePids: null,
          rssKb: null,
          cpuPercent: null,
          activePermits: null,
          waiters: null,
          helperRefs: null,
          worktreeIds: input.scopedRead && !worktreesKnown ? null : worktrees.map((record) => record.id),
          sessionIds: null,
          ...(worktreesKnown ? {} : { detail: "managed checkout registration is incomplete, missing or replaced" }),
        },
    ...(input.scopedRead ? [unknownOwner({ kind: 'durable-helper', owner: 'GoalWakeDurableHelper', generation,
      detail: 'Durable helper rows identify a session key and lack a physical session generation' })] : []),
  ];

  if (providerEnabled) {
    try {
      // Rebuild from the owner journal on every explicit inventory read. A
      // cleared envelope/cache neither clears spending nor grants capacity.
      const { providerSpendSnapshot } = await import('../agents/provider-spend-budget.js');
      const { getSessionEntry } = await import('../config/sessions/store.js');
      const { resolveStorePath } = await import('../config/sessions/paths.js');
      const storePath = resolveStorePath(runtimeConfig.session?.store, { agentId: identity.agentId });
      const entry = input.scopedRead
        ? (await import('../config/sessions/store-read.js')).readSessionStoreReadOnly(storePath)[identity.canonicalSessionKey]
        : getSessionEntry({ storePath, sessionKey: identity.canonicalSessionKey });
      if (entry?.sessionId !== identity.expectedSessionId ||
          (input.workspaceId && (input.scopedRead || entry.workspaceId) && input.workspaceId.trim() !== entry.workspaceId)) {
        throw new Error('Provider inventory session scope mismatch');
      }
      const workspaceId = entry.workspaceId as WorkspaceId | undefined;
      if (providerPolicy.project && !workspaceId) throw new Error('Provider inventory project scope unavailable');
      const spend = providerSpendSnapshot({ ...(workspaceId ? { workspaceId, projectId: resolveProjectIdForWorkspace(workspaceId) } : {}),
        sessionKey: identity.canonicalSessionKey as SessionKey, sessionGeneration: identity.expectedSessionId }, { readOnly: input.scopedRead });
      const session = spend.find(row => row.scope === 'session');
      owners.push({ ...unknownOwner({ kind: 'provider', owner: 'ProviderOutboundBudget', generation,
        detail: 'Provider-owner spend journal; amounts are token counts and integer microdollars, not invoices' }),
        authority: 'managed', state: 'known', count: session?.activeCalls ?? null, activePermits: session?.activeCalls ?? null,
        ...(input.scopedRead ? { budgetEnabled: true, sampledAt: Date.now() } : {}),
        spend: spend.map(({ scopeKey: _key, ...value }) => value) });
    } catch {
      owners.push({ ...unknownOwner({ kind: 'provider', owner: 'ProviderOutboundBudget', generation,
        detail: 'Provider owner read unavailable; spending and remaining budget must not be inferred as zero' }),
        ...(input.scopedRead ? { budgetEnabled: true, sampledAt: Date.now() } : {}) });
    }
  } else if (input.scopedRead) {
    owners.push({ ...unknownOwner({ kind: 'provider', owner: 'ProviderOutboundBudget', generation, detail: 'Provider budget is disabled' }),
      state: 'known', budgetEnabled: false, sampledAt: Date.now() });
  }

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
