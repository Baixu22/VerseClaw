import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveConfigDir, resolveUserPath } from "../../utils.js";
import { parseTaskLedgerJournal, serializeTaskLedgerCommit } from "../../../../shared/task-ledger-journal.js";
import { withTaskLedgerJournalLockSync } from "../../../../shared/task-ledger-journal-lock.js";
import type {
  TaskLedgerEventInput,
  TaskLedgerEventType,
  TaskLedgerEvidenceRef,
  TaskLedgerNode,
  TaskLedgerNodeKind,
  TaskLedgerNodeStatus,
} from "../../../../shared/types/task-ledger.js";
import type { RuntimeResumeCheckpoint, LongTaskInterventionEventRecord } from "./store.js";

type TaskLedgerEvent = TaskLedgerEventInput & {
  id: string;
  workspaceId: string;
  createdAt: string;
};

export type LongTaskLedgerRootInput = {
  workspaceId?: string | null;
  taskLedgerRootId?: string;
  sessionKey: string;
  agentId?: string;
  runId: string;
  title: string;
  source: "task_loop" | "mission_loop";
  createdAt?: number;
  metadata?: Record<string, unknown>;
  /** Test/runner-owned process env used to resolve OPENCLAW_STATE_DIR. */
  env?: NodeJS.ProcessEnv;
};

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export function stableLongTaskLedgerRootId(input: {
  workspaceId?: string | null;
  sessionKey: string;
  runId: string;
  source: string;
}): string {
  return `tlroot_${hashText([
    input.workspaceId?.trim() || "default",
    input.sessionKey,
    input.runId,
    input.source,
  ].join("\0"))}`;
}

function normalizeTaskLedgerWorkspaceId(workspaceId?: string | null): string {
  const raw = workspaceId?.trim() || "default";
  const slug = raw
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 10);
  return `${slug || "workspace"}-${hash}`;
}

export function taskLedgerEventsPath(
  workspaceId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    env.OPENCLAW_CONFIG_DIR?.trim() ? resolveUserPath(env.OPENCLAW_CONFIG_DIR, env) : resolveConfigDir(env),
    "task-ledgers",
    "workspaces",
    normalizeTaskLedgerWorkspaceId(workspaceId),
    "events.jsonl",
  );
}

function nowIso(ms?: number): string {
  return new Date(ms ?? Date.now()).toISOString();
}

function readJournal(pathname: string): string {
  try {
    return readFileSync(pathname, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function appendLongTaskLedgerEvents(
  workspaceId: string | null | undefined,
  inputs: TaskLedgerEventInput[],
  env: NodeJS.ProcessEnv = process.env,
  validateExisting?: (events: readonly TaskLedgerEvent[]) => void,
): void {
  if (inputs.length === 0) return;
  const pathname = taskLedgerEventsPath(workspaceId, env);
  mkdirSync(dirname(pathname), { recursive: true });
  withTaskLedgerJournalLockSync(pathname, () => appendJournalUnlocked(pathname, workspaceId, inputs, validateExisting));
}

function appendJournalUnlocked(
  pathname: string, workspaceId: string | null | undefined, inputs: TaskLedgerEventInput[],
  validateExisting?: (events: readonly TaskLedgerEvent[]) => void,
): void {
  const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
  const raw = readJournal(pathname);
  const prior = parseTaskLedgerJournal(raw).events;
  validateExisting?.(prior);
  const ids = new Set(prior.map((event) => event.id));
  const keys = new Set(prior.map((event) => event.idempotencyKey).filter(Boolean));
  // Compare against the committed prefix, not siblings in this batch: a
  // shared batch key must not discard later legitimate events.
  const events = inputs.flatMap((input): TaskLedgerEvent[] => {
    if ((input.id && ids.has(input.id)) || (input.idempotencyKey && keys.has(input.idempotencyKey))) return [];
    return [{
      ...input,
      id: input.id ?? randomUUID(),
      workspaceId: normalizedWorkspaceId,
      createdAt: input.createdAt ?? nowIso(),
      idempotencyKey: input.idempotencyKey ?? null,
      taskId: input.taskId ?? input.payload.nodeId ?? input.payload.node?.id ?? null,
      sessionId: input.sessionId ?? null,
    }];
  });
  if (events.length > 0) {
    const fd = openSync(pathname, "a");
    try {
      appendFileSync(fd, `${raw && !raw.endsWith("\n") ? "\n" : ""}${serializeTaskLedgerCommit(events, null)}\n`, "utf8");
      fsyncSync(fd);
    } finally { closeSync(fd); }
  }
}

/** A revision fence in the existing journal, not another decision/evidence store.
 * Publish and fsync before owner mutation, holding the same lock until it ends.
 * A concurrent Main completion either commits before mutation or fails A2 CAS.
 */
export function withLongTaskLedgerEvidenceMutation<T>(
  owners: readonly { workspaceId: string; eventsPath: string }[], note: string, apply: () => T,
): T {
  const sorted = [...new Map(owners.map(owner => [owner.eventsPath, owner])).values()]
    .sort((a, b) => a.eventsPath.localeCompare(b.eventsPath));
  const next = (index: number): T => {
    const owner = sorted[index];
    if (!owner) return apply();
    mkdirSync(dirname(owner.eventsPath), { recursive: true });
    return withTaskLedgerJournalLockSync(owner.eventsPath, () => {
      appendJournalUnlocked(owner.eventsPath, owner.workspaceId, [{ type: 'completion_evidence_changed', actor: 'system', payload: { note } }]);
      return next(index + 1);
    });
  };
  return next(0);
}

function taskLedgerEvidence(rootId: string): TaskLedgerEvidenceRef {
  return { type: "other", ref: rootId, label: "Task Ledger root" };
}

function node(input: {
  id: string;
  rootId?: string;
  title: string;
  kind: TaskLedgerNodeKind;
  status?: TaskLedgerNodeStatus;
  owner?: "user" | "agent" | "system";
  description?: string;
  tags?: string[];
  evidenceRefs?: TaskLedgerEvidenceRef[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}): TaskLedgerNode {
  return {
    id: input.id,
    title: input.title,
    kind: input.kind,
    parentId: input.rootId ?? null,
    status: input.status ?? "todo",
    owner: input.owner ?? "agent",
    priority: "normal",
    tags: input.tags ?? [],
    ...(input.description ? { description: input.description } : {}),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    completedAt: input.status === "done" ? input.createdAt : null,
  };
}

export function ensureLongTaskLedgerRoot(input: LongTaskLedgerRootInput): string {
  const rootId = input.taskLedgerRootId ?? stableLongTaskLedgerRootId(input);
  const createdAt = nowIso(input.createdAt);
  appendLongTaskLedgerEvents(input.workspaceId, [
    {
      type: "node_created",
      actor: "system",
      taskId: rootId,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-root:${rootId}`,
      createdAt,
      payload: {
        node: node({
          id: rootId,
          title: input.title,
          kind: "goal",
          status: "doing",
          owner: "agent",
          tags: ["long-task", input.source],
          evidenceRefs: [{ type: "session", ref: input.sessionKey }],
          metadata: {
            ...(input.metadata ?? {}),
            taskLedgerRootId: rootId,
            sessionKey: input.sessionKey,
            agentId: input.agentId,
            runId: input.runId,
            source: input.source,
            ...(input.source === 'task_loop' ? { automaticCompletion: { authority: 'task-ledger', state: 'pending' } } : {}),
          },
          createdAt,
        }),
      },
    },
    {
      type: "session_linked",
      actor: "system",
      taskId: rootId,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-root:${rootId}:session:${input.sessionKey}`,
      createdAt,
      payload: {
        sessionLink: {
          id: `lts_${hashText(`${rootId}:${input.sessionKey}`)}`,
          nodeId: rootId,
          sessionKey: input.sessionKey,
          agentId: input.agentId ?? null,
          relation: "related",
          summary: `${input.source} root session`,
          createdAt,
        },
      },
    },
  ], input.env, events => {
    const created = events.findLast(event => event.type === 'node_created' && event.payload.node?.id === rootId);
    if (!created) return;
    const previous = created.payload.node!;
    if (created.actor !== 'system' || previous.owner !== 'agent' || previous.metadata?.source !== input.source
      || previous.metadata?.sessionKey !== input.sessionKey || previous.metadata?.runId !== input.runId) {
      throw new Error('TaskLoop root ID already belongs to another task or execution');
    }
  });
  return rootId;
}

export type LongTaskLedgerRevision = {
  eventCount: number;
  revision: string;
  contentDigest: string;
};

/**
 * Read-only Task Ledger projection for DCS Stage 2. It reads the existing
 * append-only events.jsonl, filters rows owned by rootId, and returns a
 * revision plus sha256 content digest. It never writes and never returns
 * event payloads.
 */
export function readLongTaskLedgerRevision(input: {
  workspaceId?: string | null;
  taskLedgerRootId: string;
  env?: NodeJS.ProcessEnv;
}): LongTaskLedgerRevision | undefined {
  const pathname = taskLedgerEventsPath(input.workspaceId, input.env);
  if (!existsSync(pathname)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(pathname, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = parseTaskLedgerJournal(raw);
  const ownedLines = parsed.eventLines.filter((_, index) => parsed.events[index].taskId === input.taskLedgerRootId);
  if (ownedLines.length === 0) return undefined;
  const contentDigest = createHash('sha256').update(ownedLines.join(String.fromCharCode(10))).digest('hex');
  return {
    eventCount: ownedLines.length,
    revision: `rev_${ownedLines.length}_${contentDigest.slice(0, 16)}`,
    contentDigest: `sha256:${contentDigest}`,
  };
}

function statusFromLongTask(status: string): TaskLedgerNodeStatus {
  if (status === "complete" || status === "drained") return "done";
  if (status === "blocked" || status === "error" || status === "failed") return "blocked";
  if (status === "review" || status === "ask_user" || status === "checkpointed") return "review";
  return "doing";
}

function ledgerEvidenceRefs(
  rootId: string,
  refs: RuntimeResumeCheckpoint["evidenceRefs"],
): TaskLedgerEvidenceRef[] {
  const out: TaskLedgerEvidenceRef[] = [taskLedgerEvidence(rootId)];
  for (const ref of refs) {
    const type: TaskLedgerEvidenceRef["type"] =
      ref.type === "session" ||
      ref.type === "trace" ||
      ref.type === "file" ||
      ref.type === "memory" ||
      ref.type === "manual" ||
      ref.type === "tool"
        ? ref.type
        : "other";
    out.push({ type, ref: ref.ref, ...(ref.label ? { label: ref.label } : {}) });
  }
  return out;
}

export function recordCheckpointInLongTaskLedger(input: {
  taskLedgerRootId?: string;
  workspaceId?: string | null;
  sessionKey: string;
  agentId?: string;
  runId?: string;
  traceId?: string;
  checkpointId: string;
  status: string;
  checkpoint: RuntimeResumeCheckpoint;
}): void {
  const rootId = input.taskLedgerRootId;
  if (!rootId) return;
  const createdAt = input.checkpoint.createdAt || nowIso();
  const baseMetadata = {
    taskLedgerRootId: rootId,
    checkpointId: input.checkpointId,
    runId: input.runId,
    traceId: input.traceId,
    longConversationControl: {
      trigger: input.checkpoint.trigger,
      controlSignals: input.checkpoint.controlSignals,
      validationState: input.checkpoint.validationState,
      acceptanceStatus: input.checkpoint.acceptanceStatus,
    },
  };
  const events: TaskLedgerEventInput[] = [
    {
      type: "node_created",
      actor: "system",
      taskId: `ltcheck_${hashText(input.checkpointId)}`,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-checkpoint:${input.checkpointId}`,
      createdAt,
      payload: {
        node: node({
          id: `ltcheck_${hashText(input.checkpointId)}`,
          rootId,
          title: `Checkpoint: ${input.checkpoint.trigger}`,
          kind: "check",
          status: statusFromLongTask(input.status),
          tags: ["long-task", "checkpoint", input.checkpoint.trigger],
          evidenceRefs: ledgerEvidenceRefs(rootId, input.checkpoint.evidenceRefs),
          metadata: { ...baseMetadata, checkpoint: input.checkpoint },
          createdAt,
        }),
      },
    },
  ];

  input.checkpoint.decisions.forEach((decision, index) => {
    const id = `ltdecision_${hashText(`${input.checkpointId}:${index}:${decision}`)}`;
    events.push({
      type: "decision_recorded",
      actor: "system",
      taskId: id,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-checkpoint:${input.checkpointId}:decision:${index}`,
      createdAt,
      payload: {
        decision,
        node: node({
          id,
          rootId,
          title: decision.slice(0, 120),
          kind: "decision",
          status: "done",
          tags: ["long-task", "decision"],
          evidenceRefs: [taskLedgerEvidence(rootId)],
          metadata: baseMetadata,
          createdAt,
        }),
      },
    });
  });

  input.checkpoint.deviations.forEach((deviation, index) => {
    const id = `ltdeviation_${hashText(`${input.checkpointId}:${index}:${deviation}`)}`;
    events.push({
      type: "deviation_logged",
      actor: "system",
      taskId: id,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-checkpoint:${input.checkpointId}:deviation:${index}`,
      createdAt,
      payload: {
        deviation,
        node: node({
          id,
          rootId,
          title: deviation.slice(0, 120),
          kind: "deviation",
          status: "review",
          tags: ["long-task", "deviation"],
          evidenceRefs: [taskLedgerEvidence(rootId)],
          metadata: baseMetadata,
          createdAt,
        }),
      },
    });
  });

  input.checkpoint.evidenceRefs.forEach((ref, index) => {
    const id = `ltevidence_${hashText(`${input.checkpointId}:${index}:${ref.type}:${ref.ref}`)}`;
    events.push({
      type: "node_created",
      actor: "system",
      taskId: id,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-checkpoint:${input.checkpointId}:evidence:${index}`,
      createdAt,
      payload: {
        node: node({
          id,
          rootId,
          title: ref.label ?? `${ref.type}: ${ref.ref}`.slice(0, 120),
          kind: "check",
          status: "done",
          tags: ["long-task", "evidence", ref.type],
          evidenceRefs: ledgerEvidenceRefs(rootId, [ref]),
          metadata: { ...baseMetadata, evidenceRef: ref },
          createdAt,
        }),
      },
    });
  });

  input.checkpoint.reviewNeededItems.forEach((item, index) => {
    const id = `ltreview_${hashText(`${input.checkpointId}:${index}:${item}`)}`;
    events.push({
      type: "node_created",
      actor: "system",
      taskId: id,
      sessionId: input.sessionKey,
      idempotencyKey: `long-task-checkpoint:${input.checkpointId}:review:${index}`,
      createdAt,
      payload: {
        node: node({
          id,
          rootId,
          title: item.slice(0, 120),
          kind: "review",
          status: "review",
          tags: ["long-task", "review"],
          evidenceRefs: [taskLedgerEvidence(rootId)],
          metadata: baseMetadata,
          createdAt,
        }),
      },
    });
  });

  appendLongTaskLedgerEvents(input.workspaceId, events);
}

export function recordInterventionInLongTaskLedger(input: {
  taskLedgerRootId?: string;
  workspaceId?: string | null;
  event: LongTaskInterventionEventRecord;
}): void {
  const rootId = input.taskLedgerRootId;
  if (!rootId || !input.event.mode) return;
  const createdAt = nowIso(input.event.createdAt);
  const message = typeof input.event.payload.message === "string"
    ? input.event.payload.message
    : typeof input.event.payload.reason === "string"
      ? input.event.payload.reason
      : input.event.mode;
  const mode = input.event.mode;
  const kind: TaskLedgerNodeKind = mode === "interrupt" || mode === "revise-goal"
    ? "deviation"
    : mode === "queue"
      ? "review"
      : "decision";
  const eventType: TaskLedgerEventType = kind === "deviation"
    ? "deviation_logged"
    : kind === "decision"
      ? "decision_recorded"
      : "node_created";
  const id = `ltintervention_${hashText(input.event.id)}`;
  const title = mode === "revise-goal"
    ? "Goal revision requested"
    : mode === "interrupt"
      ? "User interrupted active run"
      : mode === "queue"
        ? "Queued user follow-up"
        : "User guidance recorded";
  appendLongTaskLedgerEvents(input.workspaceId, [{
    type: eventType,
    actor: "user",
    taskId: id,
    sessionId: input.event.sessionKey,
    idempotencyKey: `long-task-intervention:${input.event.id}`,
    createdAt,
    payload: {
      note: message.slice(0, 500),
      ...(eventType === "decision_recorded" ? { decision: message.slice(0, 500) } : {}),
      ...(eventType === "deviation_logged" ? { deviation: message.slice(0, 500) } : {}),
      ...(kind === "review" ? { reviewReason: message.slice(0, 500) } : {}),
      node: node({
        id,
        rootId,
        title,
        kind,
        status: mode === "guide" ? "done" : "review",
        owner: "user",
        tags: ["long-task", "intervention", mode],
        evidenceRefs: [taskLedgerEvidence(rootId), { type: "session", ref: input.event.sessionKey }],
        metadata: {
          taskLedgerRootId: rootId,
          interventionId: input.event.id,
          checkpointId: input.event.checkpointId,
          mode,
          trigger: input.event.trigger,
          status: input.event.status,
          payload: input.event.payload,
        },
        createdAt,
      }),
    },
  }]);
}
