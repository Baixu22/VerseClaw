// Runtime Lifecycle Governance Phase 1 — session scope drain.
//
// `drainScope` is the process/resource drain half of the canonical finalizer.
// It never falls back to an agent-wide kill and never uses `scopeKey` as the
// authoritative lifecycle identity.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import {
  deleteSession,
  getBashProcessRegistryState,
  snapshotProcessSessionsForLifecycle,
  type BashProcessSessionDrainHandle,
} from "../agents/bash-process-registry.js";
import { goalWakeController } from "../agents/goal-wake-controller.js";
import {
  cancelAndReapDurableHelpersForSession,
  snapshotDurableHelperPidsForSession,
} from "../agents/goal-wake-durable-cleanup.js";
import { resolveDurableHelperRoot } from "../agents/goal-wake-helper-protocol.js";
import { resolveConfigDir } from "../utils.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import type { ProcessLifecycleIdentity } from "../process/supervisor/types.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";

const execFileAsync = promisify(execFile);

export const SESSION_DRAIN_TIMEOUT_MS = 15_000;

const OS_PROCESS_TREE_LIMIT = 512;
const OS_PROCESS_PROBE_TIMEOUT_MS = 5_000;

export type DrainScopeFailureReason =
  | "fence-open"
  | "timeout"
  | "unknown-owner"
  | "os-containments-unknown"
  | "os-containments-residual"
  | "new-records"
  | "goal-rows-active"
  | "durable-helper-cleanup";

export type DrainScopeResult =
  | {
      ok: true;
      bashSessionsRemoved: number;
      supervisorRunsDrained: number;
      goalTaskFlowRows: number;
      helperClaimProtocol: number;
      osContainment: "empty";
    }
  | {
      ok: false;
      reason: DrainScopeFailureReason;
      message: string;
    };

type OsProcessRecord = {
  pid: number;
  parentPid: number;
  token: string;
  zombie: boolean;
};

type OsProcessTreeCapture = {
  status: "ok" | "unknown";
  detail?: string;
  rootPids: number[];
  capturedPids: Map<number, string>;
};

type DurableOwnerInventory = {
  goalTaskFlowRows: number;
  helperClaimProtocol: number;
};

function normalizeIdentity(identity: SessionAdmissionIdentity): SessionAdmissionIdentity {
  return {
    agentId: identity.agentId.trim(),
    canonicalSessionKey: identity.canonicalSessionKey.trim(),
    expectedSessionId: identity.expectedSessionId.trim(),
  };
}

function assertLifecycleIdentity(identity: SessionAdmissionIdentity): SessionAdmissionIdentity {
  const normalized = normalizeIdentity(identity);
  if (!normalized.agentId || !normalized.canonicalSessionKey || !normalized.expectedSessionId) {
    throw new Error("drainScope requires a complete lifecycle identity");
  }
  return normalized;
}

function toSupervisorIdentity(identity: SessionAdmissionIdentity): ProcessLifecycleIdentity {
  return { ...identity };
}

function dedupePids(values: Array<number | undefined>): number[] {
  const pids = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      pids.add(value);
    }
  }
  return [...pids];
}

async function runProcessProbe(
  file: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    const result = await execFileAsync(file, args, {
      windowsHide: true,
      timeout: OS_PROCESS_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readWindowsProcessMap(): Promise<
  { ok: true; processes: Map<number, OsProcessRecord> } | { ok: false; detail: string }
> {
  const probe = await runProcessProbe("wmic", [
    "process",
    "get",
    "ProcessId,ParentProcessId,CreationDate",
    "/format:csv",
  ]);
  if (!probe.ok) {
    return { ok: false, detail: probe.detail };
  }
  const lines = probe.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { ok: false, detail: "wmic returned an empty process table" };
  }
  const header = lines[0]?.split(",") ?? [];
  const pidIndex = header.findIndex((column) => column.trim().toLowerCase() === "processid");
  const parentIndex = header.findIndex((column) => column.trim().toLowerCase() === "parentprocessid");
  const tokenIndex = header.findIndex((column) => column.trim().toLowerCase() === "creationdate");
  if (pidIndex < 0 || parentIndex < 0 || tokenIndex < 0) {
    return { ok: false, detail: `unexpected wmic columns: ${header.join(",")}` };
  }
  const processes = new Map<number, OsProcessRecord>();
  for (const line of lines.slice(1)) {
    const columns = line.split(",");
    const pid = Number.parseInt(columns[pidIndex] ?? "", 10);
    const parentPid = Number.parseInt(columns[parentIndex] ?? "", 10);
    const token = (columns[tokenIndex] ?? "").trim();
    if (!Number.isInteger(pid) || pid <= 0 || !token) {
      continue;
    }
    processes.set(pid, {
      pid,
      parentPid: Number.isInteger(parentPid) ? parentPid : -1,
      token,
      zombie: false,
    });
  }
  return { ok: true, processes };
}

function parseLinuxProcStat(
  pid: number,
): { parentPid: number; token: string; zombie: boolean } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const commEndIndex = stat.lastIndexOf(")");
    if (commEndIndex < 0) {
      return null;
    }
    const afterComm = stat.slice(commEndIndex + 1).trimStart();
    const fields = afterComm.split(/\s+/);
    const state = fields[0];
    const parentPid = Number.parseInt(fields[1] ?? "", 10);
    const token = fields[19] ?? "";
    if (!Number.isInteger(parentPid) || !token) {
      return null;
    }
    return { parentPid, token, zombie: state === "Z" };
  } catch {
    return null;
  }
}

function readLinuxProcessMap():
  | { ok: true; processes: Map<number, OsProcessRecord> }
  | { ok: false; detail: string } {
  try {
    const entries = fs.readdirSync("/proc", { withFileTypes: true });
    const processes = new Map<number, OsProcessRecord>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pid = Number.parseInt(entry.name, 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const parsed = parseLinuxProcStat(pid);
      if (!parsed) continue;
      processes.set(pid, {
        pid,
        parentPid: parsed.parentPid,
        token: parsed.token,
        zombie: parsed.zombie,
      });
    }
    return { ok: true, processes };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readProcessMap(): Promise<
  { ok: true; processes: Map<number, OsProcessRecord> } | { ok: false; detail: string }
> {
  if (process.platform === "win32") {
    return await readWindowsProcessMap();
  }
  if (process.platform === "linux") {
    return readLinuxProcessMap();
  }
  return {
    ok: false,
    detail: `OS containment evidence is unavailable on ${process.platform}`,
  };
}

function tokenIsAfter(token: string, parentToken: string): boolean {
  const numericToken = Number(token);
  const numericParentToken = Number(parentToken);
  if (Number.isFinite(numericToken) && Number.isFinite(numericParentToken)) {
    return numericToken > numericParentToken;
  }
  // Windows CIM datetime tokens (YYYYMMDDHHmmss.uuuuuu+mmm) compare
  // lexicographically for processes from the same machine/timezone.
  return token > parentToken;
}

function collectTreePids(
  processes: Map<number, OsProcessRecord>,
  roots: number[],
): Map<number, string> {
  const captured = new Map<number, string>();
  const queue: Array<{ pid: number; token: string }> = [];
  for (const root of roots) {
    const record = processes.get(root);
    if (!record) continue;
    captured.set(root, record.token);
    queue.push({ pid: root, token: record.token });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const record of processes.values()) {
      if (record.parentPid !== current.pid) continue;
      // A child cannot be older than its parent. Windows ParentProcessId is
      // not cleared when the original parent dies, so a reused root PID can
      // otherwise capture a stale unrelated child (for example csrss.exe).
      if (!tokenIsAfter(record.token, current.token)) continue;
      if (captured.has(record.pid)) continue;
      captured.set(record.pid, record.token);
      queue.push({ pid: record.pid, token: record.token });
      if (captured.size >= OS_PROCESS_TREE_LIMIT) {
        return captured;
      }
    }
  }
  return captured;
}

async function captureProcessTrees(roots: number[]): Promise<OsProcessTreeCapture> {
  if (roots.length === 0) {
    return { status: "ok", rootPids: roots, capturedPids: new Map() };
  }
  const probe = await readProcessMap();
  if (!probe.ok) {
    return { status: "unknown", detail: probe.detail, rootPids: roots, capturedPids: new Map() };
  }
  return {
    status: "ok",
    rootPids: roots,
    capturedPids: collectTreePids(probe.processes, roots),
  };
}

type OsContainmentCheck =
  | { status: "empty" }
  | { status: "residual"; detail: string }
  | { status: "unknown"; detail: string };

const OS_RESIDUAL_SETTLE_MS = 5_000;
const OS_RESIDUAL_POLL_MS = 100;

function findLiveCapturedProcess(
  processes: Map<number, OsProcessRecord>,
  capture: OsProcessTreeCapture,
): { pid: number; reused: boolean } | undefined {
  for (const [pid, capturedToken] of capture.capturedPids) {
    const current = processes.get(pid);
    if (!current || current.zombie) {
      continue;
    }
    if (current.token !== capturedToken) {
      return { pid, reused: true };
    }
    return { pid, reused: false };
  }
  return undefined;
}

async function verifyProcessTreesTerminated(
  capture: OsProcessTreeCapture,
): Promise<OsContainmentCheck> {
  if (capture.capturedPids.size === 0) {
    return { status: "empty" };
  }
  const settleDeadline = Date.now() + OS_RESIDUAL_SETTLE_MS;
  while (true) {
    const probe = await readProcessMap();
    if (!probe.ok) {
      return { status: "unknown", detail: probe.detail };
    }
    const live = findLiveCapturedProcess(probe.processes, capture);
    if (!live) {
      return { status: "empty" };
    }
    if (live.reused) {
      return {
        status: "unknown",
        detail: `PID ${live.pid} was reused after cancellation; OS containment evidence is inconclusive`,
      };
    }
    if (Date.now() >= settleDeadline) {
      return {
        status: "residual",
        detail: `process tree still contains live PID ${live.pid} after drain wait`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, OS_RESIDUAL_POLL_MS));
  }
}

/**
 * Phase 1 has no durable goal task/flow row owner and no helper claim
 * protocol. This explicit empty-inventory check is vacuous by design; later
 * phases must extend the same drain success contract instead of introducing
 * parallel owners.
 */
function verifyDurableOwners(
  canonicalSessionKey: string,
  helperClaimProtocol = 0,
): DurableOwnerInventory {
  const active = goalWakeController.countActiveGoalWakeRowsForSession(canonicalSessionKey);
  return {
    goalTaskFlowRows: active.tasks + active.flows,
    helperClaimProtocol,
  };
}

function hasOnlyOriginalIds(
  current: BashProcessSessionDrainHandle[],
  originalIds: Set<string>,
): boolean {
  return current.every((handle) => originalIds.has(handle.id));
}

/**
 * Drains every Phase 1 process owner for one lifecycle identity.
 *
 * Success requires: the admission fence is closed, every snapshotted owner
 * handle cancelled and waited, Phase 1-absent durable owners verified empty,
 * OS process-tree containment empty with PID-reuse evidence, and no new owner
 * records after the wait.
 */
export async function drainScope(
  identity: SessionAdmissionIdentity,
  timeoutMs = SESSION_DRAIN_TIMEOUT_MS,
): Promise<DrainScopeResult> {
  const normalized = assertLifecycleIdentity(identity);
  if (!sessionAdmissionRegistry.isFenced(normalized)) {
    return {
      ok: false,
      reason: "fence-open",
      message: `refusing to drain ${normalized.canonicalSessionKey}: admission fence is not closed`,
    };
  }

  const supervisor = getProcessSupervisor();
  const bashHandles = snapshotProcessSessionsForLifecycle(normalized);
  const supervisorSnapshot = supervisor.snapshotRunsForLifecycle(toSupervisorIdentity(normalized));
  const originalBashIds = new Set(bashHandles.map((handle) => handle.id));
  const originalSupervisorRunIds = new Set(supervisorSnapshot.map((run) => run.runId));
  const durableRootDir = resolveDurableHelperRoot(resolveConfigDir());
  const durablePids = await snapshotDurableHelperPidsForSession(
    normalized.canonicalSessionKey,
    { rootDir: durableRootDir },
  );
  const rootPids = dedupePids([
    ...bashHandles.map((handle) => handle.pid),
    ...supervisorSnapshot.map((run) => run.pid),
    ...durablePids,
  ]);
  const osCapture = await captureProcessTrees(rootPids);
  const budgetMs = Math.max(1, Math.floor(timeoutMs));

  const cancelFailures: string[] = [];
  for (const handle of bashHandles) {
    if (handle.cancel() === "unknown") {
      cancelFailures.push(handle.id);
    }
  }
  const durableReapPromise = cancelAndReapDurableHelpersForSession({
    sessionKey: normalized.canonicalSessionKey,
    options: { rootDir: durableRootDir },
    timeoutMs: budgetMs,
  });

  const [supervisorDrain, bashWaits, durableReap] = await Promise.all([
    supervisor.drainRunsForLifecycle(toSupervisorIdentity(normalized), budgetMs),
    Promise.all(bashHandles.map((handle) => handle.wait(budgetMs))),
    durableReapPromise,
  ]);

  if (cancelFailures.length > 0) {
    return {
      ok: false,
      reason: "unknown-owner",
      message: `refusing to remove records for unknown bash process owner(s): ${cancelFailures.join(", ")}`,
    };
  }
  if (!supervisorDrain.drained) {
    return {
      ok: false,
      reason: "timeout",
      message: `supervised run drain timed out for ${normalized.canonicalSessionKey}`,
    };
  }
  for (const outcome of bashWaits) {
    if (outcome === "timeout") {
      return {
        ok: false,
        reason: "timeout",
        message: `bash process session drain timed out for ${normalized.canonicalSessionKey}`,
      };
    }
    if (outcome === "unknown") {
      return {
        ok: false,
        reason: "unknown-owner",
        message: `bash process session drain is in an unknown state for ${normalized.canonicalSessionKey}`,
      };
    }
  }
  if (!durableReap.ok) {
    return {
      ok: false,
      reason: durableReap.reason === "unknown-owner" ? "unknown-owner" : "durable-helper-cleanup",
      message: durableReap.message,
    };
  }

  const osCheck =
    osCapture.status === "ok"
      ? await verifyProcessTreesTerminated(osCapture)
      : { status: "unknown" as const, detail: osCapture.detail ?? "OS evidence unavailable" };
  if (osCheck.status === "unknown") {
    return {
      ok: false,
      reason: "os-containments-unknown",
      message: `OS containment evidence is unknown for ${normalized.canonicalSessionKey}: ${osCheck.detail}`,
    };
  }
  if (osCheck.status === "residual") {
    return {
      ok: false,
      reason: "os-containments-residual",
      message: `OS containment is not empty for ${normalized.canonicalSessionKey}: ${osCheck.detail}`,
    };
  }

  const durableOwners = verifyDurableOwners(
    normalized.canonicalSessionKey,
    durableReap.cancelled + durableReap.finalized,
  );
  if (durableOwners.goalTaskFlowRows > 0) {
    return {
      ok: false,
      reason: "goal-rows-active",
      message: `goal-owned task/flow rows are still active for ${normalized.canonicalSessionKey}: ${durableOwners.goalTaskFlowRows}`,
    };
  }
  const currentBashHandles = snapshotProcessSessionsForLifecycle(normalized);
  const currentSupervisorRuns = supervisor.snapshotRunsForLifecycle(toSupervisorIdentity(normalized));
  if (
    !hasOnlyOriginalIds(currentBashHandles, originalBashIds) ||
    currentSupervisorRuns.some((run) => !originalSupervisorRunIds.has(run.runId))
  ) {
    const state = getBashProcessRegistryState();
    return {
      ok: false,
      reason: "new-records",
      message: `owner registry gained new records while draining ${normalized.canonicalSessionKey} (bash running=${state.runningCount} finished=${state.finishedCount})`,
    };
  }

  for (const id of originalBashIds) {
    deleteSession(id);
  }

  return {
    ok: true,
    bashSessionsRemoved: originalBashIds.size,
    supervisorRunsDrained: originalSupervisorRunIds.size,
    goalTaskFlowRows: durableOwners.goalTaskFlowRows,
    helperClaimProtocol: durableOwners.helperClaimProtocol,
    osContainment: "empty",
  };
}
