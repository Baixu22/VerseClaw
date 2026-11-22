import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ScopedRunId } from "../types/identity-scope.js";
import type { CheckoutWriterBasis } from "../checkout-ownership.js";
import { canonicalPath, type TaskAuthorityBasis } from "./identity.js";
import type { TaskSystemStore } from "./store.js";
import type {
  TaskClaim,
  TaskContract,
  TaskCredential,
  TaskEvidence,
  TaskView,
  TaskWriterDelegation,
} from "./types.js";
import {
  readRetainedTaskArtifact,
  type TaskArtifactRetentionReceipt,
} from "./artifact-retention.js";

export type TaskRunProvenance = {
  run?: ScopedRunId;
  authority?: TaskAuthorityBasis;
  checkout?: CheckoutWriterBasis & {
    epoch: number;
    bindingRevision: number;
    effects?: Array<{
      operationId: string;
      ownerReceipt: string;
      outcome: "completed" | "not-applied";
    }>;
  };
};
export type TaskTraceEvent = { seq: number; kind: string; at: number; payload: unknown };
export type TaskTraceQuery = {
  taskNodeId: string;
  revision?: number;
  digest?: string;
  candidate?: string;
};
export type TaskModelCall = {
  callId: string;
  runId: string;
  provider: string;
  model: string;
  credential: TaskCredential;
  taskRevision: number;
  sourceDigest: string;
  startedAt: number;
  actorRole: "assigned" | "observer" | "coordinator";
  provenance?: TaskRunProvenance;
};
export type TaskModelUsage = {
  terminal: "done" | "error" | "aborted" | "incomplete" | "conflicting";
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null;
  costUsd: number | null;
  priceVersion: string | null;
  toolCallIdHashes: string[];
  endedAt: number;
};
export type TaskTraceSnapshot = {
  task: TaskView;
  ancestors: TaskContract[];
  descendants: TaskView[];
  events: TaskTraceEvent[];
  evidence: TaskEvidence[];
  retention: TaskArtifactRetentionReceipt[];
  usageEvents: TaskTraceEvent[];
  runEvents: TaskTraceEvent[];
  operationIds: string[];
};
export type TaskTraceDiagnostic = {
  code:
    | "source_changed"
    | "source_missing"
    | "candidate_changed"
    | "receipt_missing"
    | "receipt_invalid"
    | "artifact_changed"
    | "artifact_missing"
    | "artifact_unavailable"
    | "checkout_replaced"
    | "run_missing"
    | "operation_missing"
    | "effect_missing"
    | "cost_unknown"
    | "cost_conflict"
    | "phase_unknown"
    | "source_identity_unknown";
  ref: string;
};
export type TaskTraceArtifact = {
  path: string;
  sha256: string;
  state: "current" | "retained" | "stale" | "missing" | "unavailable";
  sourceState: "current" | "reclaimed" | "replaced" | "unknown";
  retentionReceiptId?: string;
};
export type TaskTraceRun = {
  runId: string;
  credential: TaskCredential;
  taskRevision: number;
  startedAt: number;
  endedAt: number | null;
  provenance?: TaskRunProvenance;
};
export type TaskTraceReport = {
  schemaVersion: 1;
  task: TaskView;
  authorityId: string;
  generatedAt: number;
  status: "current" | "stale" | "incomplete";
  ancestors: TaskContract[];
  revisions: Array<{ sequence: number; contract: TaskContract }>;
  claims: Array<{ sequence: number; claim: TaskClaim }>;
  runs: TaskTraceRun[];
  delegations: TaskWriterDelegation[];
  operations: Array<{
    operationId: string;
    tool: string;
    state: string;
    runId: string | null;
    credential: TaskCredential | null;
    startedAt: number;
    endedAt: number | null;
    resultDigest: string | null;
    effectReceiptIds: string[];
  }>;
  candidates: Array<{ sequence: number; candidate: string; revision: number; epoch: number }>;
  checks: Array<{
    receipt: TaskEvidence;
    state: "current" | "retained" | "stale" | "incomplete" | "superseded";
    artifacts: TaskTraceArtifact[];
  }>;
  costs: {
    scope: "task-subtree";
    state: "estimated" | "unknown";
    totalUsd: number | null;
    knownSubtotalUsd: number;
    totalTokens: number | null;
    knownTokens: number;
    calls: number;
    unknownCalls: number;
    duplicateObservations: number;
    records: Array<{ call: TaskModelCall; usage: TaskModelUsage | null; run: ScopedRunId | null }>;
  };
  phases: Record<
    "queue" | "execution" | "verification" | "recovery",
    {
      durationMs: number | null;
      intervals: Array<{ start: number; end: number; from: string; to: string }>;
    }
  >;
  cleanup: TaskTraceEvent[];
  diagnostics: TaskTraceDiagnostic[];
  events: TaskTraceEvent[];
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pathKey = (path: string) =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const credentialKey = (credential: TaskCredential, runId: string) =>
  JSON.stringify([credential.sessionKey, credential.generation, credential.epoch, runId]);
const contained = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function readArtifactHash(file: string): string {
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > 32n * 1024n * 1024n)
      throw new Error("TASK_EVIDENCE_SIZE_LIMIT");
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const length = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position,
      );
      if (!length) throw new Error("TASK_EVIDENCE_CHANGED");
      hash.update(buffer.subarray(0, length));
      position += length;
    }
    const after = fstatSync(fd, { bigint: true });
    const current = statSync(file, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      throw new Error("TASK_EVIDENCE_CHANGED");
    if (
      after.dev !== current.dev ||
      after.ino !== current.ino ||
      after.size !== current.size ||
      after.mtimeNs !== current.mtimeNs
    )
      throw new Error("TASK_EVIDENCE_CHANGED");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

function unionDuration(intervals: Array<{ start: number; end: number }>): number | null {
  if (!intervals.length) return null;
  let total = 0,
    through = -Infinity;
  for (const interval of intervals.toSorted((a, b) => a.start - b.start)) {
    total += Math.max(0, interval.end - Math.max(interval.start, through));
    through = Math.max(through, interval.end);
  }
  return total;
}

function readRuns(events: TaskTraceEvent[]): TaskTraceRun[] {
  return events
    .filter((event) => event.kind === "run_started")
    .map((event) => {
      const start = event.payload as Omit<TaskTraceRun, "endedAt">;
      const end = events.find(
        (end) =>
          end.seq > event.seq &&
          end.kind === "run_finished" &&
          same(object(end.payload).credential, start.credential) &&
          object(end.payload).runId === start.runId,
      );
      const settled = object(end?.payload).provenance as TaskRunProvenance | undefined;
      return {
        ...start,
        endedAt: end?.at ?? null,
        provenance: settled?.run ? settled : start.provenance,
      };
    });
}

/** Query existing owner records and diagnose missing or changed references. */
export function readTaskTrace(
  store: TaskSystemStore,
  expected: TaskTraceQuery,
  readIncarnation: (root: string) => string,
): TaskTraceReport {
  const snapshot = store.traceSnapshot(expected.taskNodeId);
  const { task, events } = snapshot;
  const diagnostics: TaskTraceDiagnostic[] = [];
  const diagnose = (code: TaskTraceDiagnostic["code"], ref: string) => {
    if (!diagnostics.some((d) => d.code === code && d.ref === ref)) diagnostics.push({ code, ref });
  };
  const revisions = events
    .filter((e) => e.kind === "created" || e.kind === "revised")
    .map((e) => ({ sequence: e.seq, contract: e.payload as TaskContract }));
  if (
    !revisions.some(
      (r) =>
        r.contract.revision === task.contract.revision &&
        r.contract.digest === task.contract.digest,
    )
  )
    diagnose("source_missing", task.contract.taskNodeId);
  if (
    (expected.revision !== undefined && expected.revision !== task.contract.revision) ||
    (expected.digest !== undefined && expected.digest !== task.contract.digest)
  )
    diagnose("source_changed", task.contract.taskNodeId);
  const claims = events
    .filter((e) => e.kind === "claimed" || e.kind === "handoff")
    .map((e) => ({ sequence: e.seq, claim: e.payload as TaskClaim }));
  const candidates = events
    .filter((e) => e.kind === "submitted")
    .map((e) => ({
      sequence: e.seq,
      ...(e.payload as { candidate: string; revision: number; epoch: number }),
    }));
  const latestCandidate = candidates.at(-1);
  if (expected.candidate !== undefined && expected.candidate !== latestCandidate?.candidate)
    diagnose("candidate_changed", expected.candidate);
  const delegations = events
    .filter((e) => e.kind === "delegation_prepared")
    .map((e) => e.payload as TaskWriterDelegation);
  const runs = readRuns(events);
  const familyRuns = readRuns(snapshot.runEvents);
  const operations = events
    .filter((e) => e.kind === "operation_started")
    .map((e) => {
      const started = e.payload as {
        operationId: string;
        tool: string;
        runId?: string;
        credential: TaskCredential;
      };
      const settled = events.findLast(
        (end) =>
          end.seq > e.seq &&
          [
            "operation_settled",
            "effect_reconciled",
            "operation_reconciled",
            "process_reconciled",
          ].includes(end.kind) &&
          object(end.payload).operationId === started.operationId,
      );
      const value = object(settled?.payload);
      return {
        operationId: started.operationId,
        tool: started.tool,
        state: String(value.state ?? (settled ? "reconciled" : "pending")),
        runId: started.runId ?? null,
        credential: started.credential ?? null,
        startedAt: e.at,
        endedAt: settled?.at ?? null,
        resultDigest: typeof value.resultDigest === "string" ? value.resultDigest : null,
        effectReceiptIds:
          typeof object(value.receipt).id === "string" ? [object(value.receipt).id as string] : [],
      };
    });
  for (const id of snapshot.operationIds)
    if (!operations.some((operation) => operation.operationId === id))
      diagnose("operation_missing", id);
  for (const operation of operations) {
    if (
      !operation.runId ||
      !runs.some(
        (run) => run.runId === operation.runId && same(run.credential, operation.credential),
      )
    )
      diagnose("run_missing", operation.operationId);
    if (operation.endedAt === null || operation.state === "unknown")
      diagnose("effect_missing", operation.operationId);
    for (const run of runs.filter(
      (run) => run.runId === operation.runId && same(run.credential, operation.credential),
    )) {
      const effect = run.provenance?.checkout?.effects?.find(
        (effect) => effect.operationId === operation.operationId,
      );
      if (effect) operation.effectReceiptIds.push(effect.ownerReceipt);
    }
  }
  const checks = snapshot.evidence.map((receipt) => {
    const evidenceEvent = events.find(
      (e) => ["evidence", "owner_verified"].includes(e.kind) && same(e.payload, receipt),
    );
    const sourceRevision = revisions.find(
      (r) => r.contract.revision === receipt.revision,
    )?.contract;
    const criterion = sourceRevision?.acceptance.find((c) => c.id === receipt.criterionId);
    const superseded =
      receipt.revision !== task.contract.revision ||
      Boolean(
        latestCandidate &&
        (receipt.epoch !== latestCandidate.epoch ||
          (receipt.candidate !== latestCandidate.candidate &&
            !(
              criterion?.verification.kind === "tool-result" &&
              receipt.verifier === "runtime-tool-owner"
            ))),
      );
    let valid = Boolean(
      evidenceEvent && criterion && receipt.taskNodeId === task.contract.taskNodeId,
    );
    if (criterion?.verification.kind === "file-sha256")
      valid &&=
        receipt.verifier === "host-file-verifier" &&
        receipt.sha256 === criterion.verification.sha256;
    if (criterion?.verification.kind === "tool-result")
      valid &&= receipt.verifier === "runtime-tool-owner";
    if (criterion?.verification.kind === "owner-receipt")
      valid &&= Boolean(
        receipt.ownerProof &&
        receipt.verifier === `owner:${criterion.verification.owner}` &&
        receipt.ownerProof.verifierReceiptId === receipt.receiptId &&
        receipt.ownerProof.effectReceiptId &&
        /^[a-f0-9]{64}$/i.test(receipt.ownerProof.evidenceDigest),
      );
    if (!valid) diagnose("receipt_invalid", receipt.receiptId);
    if (!superseded && valid && latestCandidate) {
      try {
        store.assertCompletionEvidenceCurrent(receipt, latestCandidate!.candidate);
      } catch {
        valid = false;
        diagnose("receipt_invalid", receipt.receiptId);
      }
    }
    let origin: string | undefined;
    const incarnations = new Map<string, string>();
    for (const event of events.filter((e) => e.seq <= (evidenceEvent?.seq ?? 0))) {
      const value = object(event.payload);
      if (["claimed", "handoff"].includes(event.kind) && typeof value.worktree === "string")
        origin = value.worktree;
      if (event.kind === "delegation_prepared" && value.mode === "writer")
        origin = value.childWorktree as string;
      if (event.kind === "writer_returned") origin = object(value.to).worktree as string;
      if (event.kind === "run_started") {
        const authority = object(object(value.provenance).authority);
        if (
          typeof authority.executionWorktree === "string" &&
          typeof authority.worktreeIncarnation === "string"
        )
          incarnations.set(pathKey(authority.executionWorktree), authority.worktreeIncarnation);
      }
    }
    const incarnation = origin ? incarnations.get(pathKey(origin)) : undefined;
    const artifacts = [
      ...new Map(
        [{ path: receipt.path, sha256: receipt.sha256 }, ...(receipt.inputArtifacts ?? [])].map(
          (a) => [JSON.stringify(a), a],
        ),
      ).values(),
    ].map((artifact, index): TaskTraceArtifact => {
      const full = origin ? resolve(origin, artifact.path) : undefined;
      const retained = snapshot.retention.find(
        (r) =>
          r.source.taskNodeId === receipt.taskNodeId &&
          r.source.sourceKey === `evidence:${receipt.receiptId}:${index}` &&
          r.source.kind === "evidence" &&
          r.source.sha256 === artifact.sha256 &&
          origin &&
          pathKey(r.source.worktree) === pathKey(origin) &&
          full &&
          pathKey(r.source.path) === pathKey(full),
      );
      const result: TaskTraceArtifact = {
        ...artifact,
        state: "unavailable",
        sourceState: "unknown",
      };
      if (origin && full && contained(origin, full)) {
        try {
          if (!existsSync(origin)) result.sourceState = "reclaimed";
          else if (incarnation && readIncarnation(origin) !== incarnation)
            result.sourceState = "replaced";
          else {
            result.sourceState = incarnation ? "current" : "unknown";
            if (!incarnation) diagnose("source_identity_unknown", receipt.receiptId);
            if (!existsSync(full)) result.state = "missing";
            else if (!contained(canonicalPath(origin), canonicalPath(full))) result.state = "stale";
            else result.state = readArtifactHash(full) === artifact.sha256 ? "current" : "stale";
            if (incarnation && readIncarnation(origin) !== incarnation)
              result.sourceState = "replaced";
          }
        } catch {
          result.state = "unavailable";
        }
      }
      if (result.sourceState === "replaced") diagnose("checkout_replaced", receipt.receiptId);
      if (result.state === "stale") diagnose("artifact_changed", artifact.path);
      if (retained) {
        try {
          readRetainedTaskArtifact(retained);
          result.state = "retained";
          result.retentionReceiptId = retained.receiptId;
        } catch {
          result.state = "stale";
          diagnose("artifact_changed", retained.receiptId);
        }
      }
      if (result.state === "missing") diagnose("artifact_missing", artifact.path);
      if (result.state === "unavailable") diagnose("artifact_unavailable", artifact.path);
      return result;
    });
    const state = superseded
      ? "superseded"
      : !valid
        ? "incomplete"
        : artifacts.some((a) => a.state === "stale" || a.sourceState === "replaced")
          ? "stale"
          : artifacts.some((a) => a.state === "missing" || a.state === "unavailable")
            ? "incomplete"
            : artifacts.some((a) => a.state === "retained")
              ? "retained"
              : "current";
    return { receipt, state: state as TaskTraceReport["checks"][number]["state"], artifacts };
  });
  if (task.contract.state === "done")
    for (const criterion of task.contract.acceptance) {
      if (
        !checks.some(
          (c) =>
            c.receipt.criterionId === criterion.id && ["current", "retained"].includes(c.state),
        )
      )
        diagnose("receipt_missing", criterion.id);
    }
  if (task.contract.state === "done" && !latestCandidate) diagnose("receipt_missing", "submission");
  for (const check of checks)
    if (check.receipt.operationId) {
      const operation = operations.find((op) => op.operationId === check.receipt.operationId);
      if (!operation) diagnose("operation_missing", check.receipt.operationId);
      else if (["current", "retained"].includes(check.state))
        operation.effectReceiptIds.push(
          check.receipt.ownerProof?.effectReceiptId ?? check.receipt.receiptId,
        );
    }
  const calls = new Map<string, TaskModelCall>();
  const usage = new Map<string, TaskModelUsage>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  for (const event of snapshot.usageEvents) {
    if (event.kind === "model_call_started") {
      const call = event.payload as TaskModelCall,
        old = calls.get(call.callId);
      if (old && !same(old, call)) conflicts.add(call.callId);
      else if (old) duplicates++;
      else calls.set(call.callId, call);
    } else if (event.kind === "model_usage") {
      const record = event.payload as { callId: string; usage: TaskModelUsage },
        old = usage.get(record.callId);
      if (old && !same(old, record.usage)) conflicts.add(record.callId);
      else if (old) duplicates++;
      else usage.set(record.callId, record.usage);
    } else if (event.kind === "model_usage_conflict")
      conflicts.add(String(object(event.payload).callId));
  }
  const orphanUsage = [...usage.keys()].filter((callId) => !calls.has(callId));
  orphanUsage.forEach((callId) => diagnose("cost_conflict", callId));
  let knownSubtotalUsd = 0,
    knownTokens = 0,
    unknownCalls = 0,
    unknownTokens = false;
  const records = [...calls.values()].map((call) => {
    // The first model call can precede checkout admission. Join its original
    // run receipt while preserving the model-call facts captured at start.
    const originalRun = familyRuns.find(
      (run) =>
        run.runId === call.runId &&
        run.taskRevision === call.taskRevision &&
        same(run.credential, call.credential),
    );
    const resolvedRun = call.provenance?.run ?? originalRun?.provenance?.run;
    const run =
      resolvedRun?.runId === call.runId &&
      resolvedRun.scope.sessionKey === call.credential.sessionKey
        ? resolvedRun
        : null;
    if (!run) diagnose("source_identity_unknown", call.callId);
    const value = conflicts.has(call.callId) ? null : (usage.get(call.callId) ?? null);
    if (conflicts.has(call.callId)) diagnose("cost_conflict", call.callId);
    if (!value || value.costUsd === null || !value.priceVersion) {
      unknownCalls++;
      diagnose("cost_unknown", call.callId);
    } else knownSubtotalUsd += value.costUsd;
    if (!value?.usage) unknownTokens = true;
    else knownTokens += value.usage.total;
    return { call, usage: value, run };
  });
  if (!records.length) diagnose("cost_unknown", task.contract.taskNodeId);
  const phases: TaskTraceReport["phases"] = {
    queue: { durationMs: null, intervals: [] },
    execution: { durationMs: null, intervals: [] },
    verification: { durationMs: null, intervals: [] },
    recovery: { durationMs: null, intervals: [] },
  };
  const queuedRevisions = new Set<number>();
  for (const claim of claims.filter(
    (claim) => events.find((event) => event.seq === claim.sequence)?.kind === "claimed",
  )) {
    const ready = revisions.findLast((r) => r.sequence < claim.sequence);
    if (ready && !queuedRevisions.has(ready.sequence)) {
      phases.queue.intervals.push({
        start: ready.contract.updatedAt,
        end: events.find((e) => e.seq === claim.sequence)!.at,
        from: "task-ready",
        to: "claimed",
      });
      queuedRevisions.add(ready.sequence);
    }
  }
  for (const run of runs)
    if (run.endedAt !== null)
      phases.execution.intervals.push({
        start: run.startedAt,
        end: run.endedAt,
        from: "run_started",
        to: "run_finished",
      });
  for (const candidate of candidates) {
    const start = events.find((e) => e.seq === candidate.sequence)!;
    const end = events.find(
      (e) => e.seq > start.seq && ["accepted", "repair_started"].includes(e.kind),
    );
    if (end)
      phases.verification.intervals.push({
        start: start.at,
        end: end.at,
        from: "submitted",
        to: end.kind,
      });
  }
  for (const event of events.filter((e) =>
    ["recovery_required", "interrupted_run_replaced"].includes(e.kind),
  )) {
    const end = events.find(
      (e) => e.seq > event.seq && ["handoff", "context_rehydrated"].includes(e.kind),
    );
    if (end)
      phases.recovery.intervals.push({
        start: event.at,
        end: end.at,
        from: event.kind,
        to: end.kind,
      });
  }
  for (const phase of Object.keys(phases) as Array<keyof typeof phases>) {
    phases[phase].durationMs = unionDuration(phases[phase].intervals);
    if (
      (phase === "execution" && runs.some((run) => run.endedAt === null)) ||
      (phase === "verification" && phases.verification.intervals.length !== candidates.length)
    )
      phases[phase].durationMs = null;
    if (phases[phase].durationMs === null) diagnose("phase_unknown", phase);
  }
  for (const run of runs) {
    if (!run.provenance?.run)
      diagnose("source_identity_unknown", credentialKey(run.credential, run.runId));
  }
  return {
    schemaVersion: 1,
    task,
    authorityId: store.domain.id,
    generatedAt: store.now(),
    ancestors: snapshot.ancestors,
    status: diagnostics.some((d) =>
      ["source_changed", "candidate_changed", "artifact_changed", "checkout_replaced"].includes(
        d.code,
      ),
    )
      ? "stale"
      : diagnostics.some((d) =>
            [
              "source_missing",
              "receipt_missing",
              "receipt_invalid",
              "artifact_missing",
              "artifact_unavailable",
              "run_missing",
              "operation_missing",
              "source_identity_unknown",
            ].includes(d.code),
          )
        ? "incomplete"
        : "current",
    revisions,
    claims,
    runs,
    delegations,
    operations,
    candidates,
    checks,
    costs: {
      scope: "task-subtree",
      state:
        records.length > 0 && unknownCalls === 0 && orphanUsage.length === 0
          ? "estimated"
          : "unknown",
      totalUsd:
        records.length > 0 && unknownCalls === 0 && orphanUsage.length === 0
          ? knownSubtotalUsd
          : null,
      knownSubtotalUsd,
      totalTokens:
        records.length > 0 && !unknownTokens && orphanUsage.length === 0 ? knownTokens : null,
      knownTokens,
      calls: records.length,
      unknownCalls,
      duplicateObservations: duplicates,
      records,
    },
    phases,
    cleanup: events.filter((e) =>
      ["artifact_retained", "worktree_cleanup_prepared", "worktree_cleanup_completed"].includes(
        e.kind,
      ),
    ),
    diagnostics,
    events,
  };
}
