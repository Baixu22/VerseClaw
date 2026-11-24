/**
 * F2 cleanup barrier for VerseGit-bound subagent resources.
 *
 * The host-owned barrier seals evidence and detaches the provider binding before
 * any disposable resource is removed. Unbound runs retain their pre-F2 cleanup
 * behavior; VerseGit-enabled cleanup fails closed when the barrier is missing.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  createVerseGitCleanupBarrier,
  cleanupInventoryFromResources,
  verseGitCleanupResourceId,
  type FileVerseGitCleanupBarrier,
} from "../../../shared/versegit-cleanup-barrier.js";
import type {
  VerseGitCleanupBarrierRecord,
  VerseGitCleanupDeletionAuthorization,
  VerseGitCleanupIdentity,
  VerseGitCleanupInventory,
  VerseGitCleanupResource,
} from "../../../shared/types/versegit.js";
import type {
  VerseGitBindingEndReason,
  VerseGitBindingRecord,
  VerseGitRuntimeBindingPort,
} from "../../../shared/versegit-runtime-contract.js";
import { isPidAlive } from "../shared/pid-alive.js";
import { listRunningSessions } from "./bash-process-registry.js";
import {
  clearVerseGitRuntimeBindingForRun,
  endVerseGitRuntimeBindingForRun,
  getVerseGitRuntimeBindingContextForRun,
} from "../plugin-sdk/versegit-binding-registry.js";
import { createVerseGitRuntimeBindingPortFromEnv } from "../plugin-sdk/versegit-binding-port.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

type CleanupActions = {
  stopSession?: () => Promise<void>;
  deleteSession?: () => Promise<void>;
  deleteAttachments?: () => Promise<void>;
  deleteTranscript?: () => Promise<void>;
  retireManagers?: () => Promise<void>;
  cleanupWorktree: (authorization: VerseGitCleanupDeletionAuthorization | null) => void;
};

type CleanupResult = {
  ok: boolean;
  barriered: boolean;
  issues: string[];
  record: VerseGitCleanupBarrierRecord | null;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function currentIdentity(binding: VerseGitBindingRecord): VerseGitCleanupIdentity {
  let headRef = "HEAD";
  let baseOid = binding.baseOid;
  if (existsSync(binding.worktreePath)) {
    baseOid = git(binding.worktreePath, ["rev-parse", "HEAD"]);
    try {
      headRef = git(binding.worktreePath, ["symbolic-ref", "-q", "HEAD"]) || "HEAD";
    } catch {
      // Detached worktrees still bind the exact HEAD oid.
    }
  }
  const refsDigest = "sha256:" + createHash("sha256")
    .update(`${binding.repoId}\0${binding.worktreeId}\0${headRef}\0${baseOid}`)
    .digest("hex");
  return {
    ownerId: binding.ownerId,
    epoch: binding.epoch,
    authorizationId: binding.authorizationId,
    baseOid,
    refsDigest,
  };
}

function runningPidsForSession(sessionKey: string): number[] {
  const pids = new Set<number>();
  for (const session of listRunningSessions()) {
    if (session.sessionKey !== sessionKey && session.lifecycleCanonicalSessionKey !== sessionKey) continue;
    if (typeof session.pid === "number" && Number.isInteger(session.pid) && session.pid > 0) {
      pids.add(session.pid);
    }
  }
  return [...pids].sort((left, right) => left - right);
}

function settleResult(result: CleanupResult): CleanupResult {
  if (result.record?.status === "deleted") clearVerseGitRuntimeBindingForRun(result.record.runId);
  return result;
}

async function runLegacyActions(actions: CleanupActions, sessionPresent: boolean): Promise<CleanupResult> {
  try {
    if (sessionPresent) await actions.deleteSession?.();
    await actions.deleteAttachments?.();
    await actions.deleteTranscript?.();
    await actions.retireManagers?.();
    actions.cleanupWorktree(null);
    return { ok: true, barriered: false, issues: [], record: null };
  } catch (error) {
    return { ok: false, barriered: false, issues: [String(error).slice(0, 300)], record: null };
  }
}

function allIssues(values: readonly string[]): string[] {
  return [...new Set(values)];
}
function cleanupReferences(entry: SubagentRunRecord, extra: readonly string[]): string[] {
  const references = new Set<string>(extra.filter(Boolean));
  const status = entry.delivery?.status;
  if (status === "pending" || status === "in_progress") references.add(`delivery:${status}`);
  return [...references];
}

/** Seal, detach and complete the same barrier for every VerseGit-bound cleanup path. */
export async function runSubagentVerseGitCleanup(params: {
  runId: string;
  entry: SubagentRunRecord;
  cleanup: "delete" | "keep";
  sessionPresent: boolean;
  bindingEndReason: VerseGitBindingEndReason;
  actor?: string;
  references?: readonly string[];
  actions: CleanupActions;
}): Promise<CleanupResult> {
  const root = process.env.CLAWX_VERSGIT_CLEANUP_ROOT?.trim();
  const bindingContext = getVerseGitRuntimeBindingContextForRun(params.runId);
  if (!root) return runLegacyActions(params.actions, params.sessionPresent);
  const barrier = createVerseGitCleanupBarrier(root) as FileVerseGitCleanupBarrier;
  const existing = barrier.read(params.runId);
  if (existing?.status === "deleted") return settleResult({ ok: true, barriered: true, issues: [], record: existing });
  const durable = params.entry.orchestration?.verseGitCleanup;
  const binding: VerseGitBindingRecord | undefined = bindingContext?.binding
    ?? (durable
      ? {
          schema: "clawx.versegit.runtime-binding/v1",
          bindingId: durable.bindingId,
          authorizationId: durable.authorizationId,
          baseOid: durable.baseOid,
          refsDigest: durable.refsDigest,
          requestId: durable.requestId,
          runId: params.runId,
          traceId: durable.requestId,
          repoId: durable.repoId,
          worktreeId: durable.worktreeId,
          worktreePath: durable.worktreePath,
          agentSessionId: params.entry.childSessionKey,
          vgSessionId: params.entry.childSessionKey,
          ownerId: durable.ownerId,
          epoch: durable.epoch,
          mode: "M1",
          phase: "attached" as const,
          createdAt: new Date(0).toISOString(),
          childSessionKey: params.entry.childSessionKey,
          childRunId: params.runId,
        }
      : undefined);
  if (!binding && !existing) {
    return {
      ok: false,
      barriered: false,
      issues: ["cleanup_binding_identity_unavailable"],
      record: null,
    };
  }

  const port: VerseGitRuntimeBindingPort | null =
    bindingContext?.port ?? createVerseGitRuntimeBindingPortFromEnv();
  const expected = existing?.expected ?? (binding ? currentIdentity(binding) : null);
  if (!expected) {
    return { ok: false, barriered: false, issues: ["cleanup_expected_identity_unavailable"], record: existing };
  }
  const current = binding ? currentIdentity(binding) : existing?.current ?? expected;
  let stopIssue: string | null = null;
  try {
    if (params.sessionPresent) await params.actions.stopSession?.();
  } catch (error) {
    stopIssue = "session_stop_failed:" + String(error).slice(0, 160);
  }
  const resources: VerseGitCleanupResource[] = existing
    ? existing.resources.map((resource) => ({ ...resource }))
    : [];
  const existingWorktree = existing?.resources.find((resource) => resource.kind === "worktree")?.target;
  const worktreeIdentity = binding?.worktreePath ?? existingWorktree;
  if (!existing) {
    if (worktreeIdentity && existsSync(worktreeIdentity)) {
      resources.push({
        kind: "worktree",
        id: verseGitCleanupResourceId("worktree", worktreeIdentity),
        target: worktreeIdentity,
        owned: true,
        preserve: false,
      });
    }
    if (params.actions.deleteSession && params.sessionPresent) {
      const target = `manager:${params.entry.childSessionKey}`;
      resources.push({ kind: "manager", id: verseGitCleanupResourceId("manager", target), target, owned: true, preserve: false });
    }
    for (const value of [params.entry.attachmentsDir, params.entry.execution?.transcriptFile]) {
      if (value && existsSync(value)) {
        resources.push({ kind: "temp", id: verseGitCleanupResourceId("temp", value), target: value, owned: true, preserve: false });
      }
    }
    for (const pid of runningPidsForSession(params.entry.childSessionKey)) {
      resources.push({ kind: "process", id: verseGitCleanupResourceId("process", String(pid)), target: String(pid), owned: true, preserve: false });
    }
  }
  const worktreeResourceId = resources.find((resource) => resource.kind === "worktree")?.id ?? null;
  const beforePids = [...new Set([
    ...runningPidsForSession(params.entry.childSessionKey),
    ...(existing ? resources
        .filter((resource) => resource.kind === "process")
        .map((resource) => Number(resource.target))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) : []),
  ])];
  const evidenceDigests = existing?.evidenceDigests ?? [digest({
    runId: params.runId,
    sessionId: params.entry.childSessionKey,
    completion: params.entry.completion ?? null,
    delivery: params.entry.delivery ?? null,
    orchestration: params.entry.orchestration ?? null,
    outcome: params.entry.outcome ?? null,
  })];
  const deletedKinds = existing?.deletedKinds ?? [...new Set(resources.map((resource) => resource.kind))];
  const seal = barrier.seal({
    runId: params.runId,
    sessionId: existing?.sessionId ?? params.entry.childSessionKey,
    bindingId: existing?.bindingId ?? binding?.bindingId ?? "",
    actor: existing?.actor ?? params.actor ?? "codex",
    expected,
    current,
    references: cleanupReferences(params.entry, params.references ?? []),
    evidenceDigests,
    inventoryBefore: existing?.inventoryBefore ?? cleanupInventoryFromResources(resources),
    resources,
    deletedKinds,
    stopAccepting: true,
    drain: beforePids.length === 0 && !stopIssue
      ? { ok: true, issues: [] }
      : { ok: false, issues: ["processes_still_running", ...(stopIssue ? [stopIssue] : [])] },
  });
  if (!seal.ok || !seal.record || !seal.sealId) {
    return settleResult({ ok: false, barriered: true, issues: seal.issues, record: seal.record });
  }
  const sealId = seal.sealId;

  if (!port) {
    const failed = barrier.recoveryRequired({
      runId: params.runId,
      sealId,
      issues: ["vg_detach_port_unavailable"],
      inventoryAfter: cleanupInventoryFromResources(resources),
    });
    return settleResult({ ok: false, barriered: true, issues: ["vg_detach_port_unavailable"], record: failed.record });
  }
  const endError = bindingContext
    ? await endVerseGitRuntimeBindingForRun(params.runId, params.bindingEndReason)
    : await port.end({
        bindingId: seal.record.bindingId,
        reason: params.bindingEndReason,
      }).then(() => null, (error: unknown) => error instanceof Error ? error : new Error(String(error)));
  const endCode = (endError as { code?: unknown } | null)?.code;
  if (endError && endCode !== "BINDING_ENDED") {
    const failed = barrier.recoveryRequired({
      runId: params.runId,
      sealId,
      issues: ["vg_detach_failed", String(endError).slice(0, 200)],
      inventoryAfter: cleanupInventoryFromResources(resources),
    });
    return settleResult({ ok: false, barriered: true, issues: ["vg_detach_failed"], record: failed.record });
  }
  const detached = barrier.markDetached({
    runId: params.runId,
    sealId,
    current,
    vgDetached: true,
  });
  if (!detached.ok || !detached.record) {
    return settleResult({ ok: false, barriered: true, issues: detached.issues, record: detached.record });
  }

  const issues: string[] = [];
  try {
    if (params.sessionPresent) await params.actions.deleteSession?.();
  } catch (error) {
    issues.push("session_delete_failed:" + String(error).slice(0, 160));
  }
  try {
    await params.actions.deleteAttachments?.();
  } catch (error) {
    issues.push("attachment_delete_failed:" + String(error).slice(0, 160));
  }
  try {
    await params.actions.deleteTranscript?.();
  } catch (error) {
    issues.push("transcript_delete_failed:" + String(error).slice(0, 160));
  }
  try {
    await params.actions.retireManagers?.();
  } catch (error) {
    issues.push("manager_retire_failed:" + String(error).slice(0, 160));
  }
  try {
    params.actions.cleanupWorktree(worktreeResourceId
      ? {
          barrierRoot: root,
          runId: params.runId,
          sealId,
          resourceKind: "worktree",
          resourceId: worktreeResourceId,
          expected,
        }
      : null);
  } catch (error) {
    issues.push("worktree_delete_failed:" + String(error).slice(0, 160));
  }

  const survivorPids = beforePids.filter((pid) => isPidAlive(pid));
  const survivors = [
    ...survivorPids.map((pid) => `process:${pid}`),
    ...(params.entry.attachmentsDir && existsSync(params.entry.attachmentsDir)
      ? [`temp:${params.entry.attachmentsDir}`]
      : []),
    ...(params.entry.execution?.transcriptFile && existsSync(params.entry.execution.transcriptFile)
      ? [`temp:${params.entry.execution.transcriptFile}`]
      : []),
    ...(worktreeIdentity && existsSync(worktreeIdentity) ? [`worktree:${worktreeIdentity}`] : []),
  ];
  if (issues.length > 0) {
    const failureInventory: VerseGitCleanupInventory = {
      observed: true,
      processes: survivorPids.length,
      managers: params.sessionPresent && issues.some((issue) => issue.startsWith("session_delete_failed")) ? 1 : 0,
      worktrees: worktreeIdentity && existsSync(worktreeIdentity) ? 1 : 0,
      tempRoots: [
        params.entry.attachmentsDir,
        params.entry.execution?.transcriptFile,
      ].filter((value): value is string => Boolean(value && existsSync(value))).length,
      survivors,
    };
    const failed = barrier.recoveryRequired({
      runId: params.runId,
      sealId,
      issues,
      inventoryAfter: failureInventory,
    });
    return settleResult({ ok: false, barriered: true, issues: failed.record?.issues ?? issues, record: failed.record ?? detached.record });
  }
  const inventoryAfter: VerseGitCleanupInventory = {
    observed: true,
    processes: survivorPids.length,
    managers: params.sessionPresent && issues.some((issue) => issue.startsWith("session_delete_failed")) ? 1 : 0,
    worktrees: worktreeIdentity && existsSync(worktreeIdentity) ? 1 : 0,
    tempRoots: survivors.filter((value) => value.startsWith("temp:")).length,
    survivors,
  };
  const complete = barrier.complete({
    runId: params.runId,
    sealId,
    inventoryAfter,
  });
  const combinedIssues = allIssues([...issues, ...complete.issues]);
  return settleResult({
    ok: complete.ok && issues.length === 0,
    barriered: true,
    issues: combinedIssues,
    record: complete.record ?? detached.record,
  });
}
