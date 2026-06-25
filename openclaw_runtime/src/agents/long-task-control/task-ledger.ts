import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveConfigDir } from "../../utils.js";
import type { RuntimeResumeCheckpoint, LongTaskInterventionEventRecord } from "./store.js";

type TaskLedgerNodeKind =
  | "goal"
  | "milestone"
  | "task"
  | "check"
  | "decision"
  | "risk"
  | "deviation"
  | "review";

type TaskLedgerNodeStatus = "todo" | "doing" | "blocked" | "review" | "done" | "dropped";
type TaskLedgerEventType =
  | "node_created"
  | "decision_recorded"
  | "deviation_logged"
  | "review_requested"
  | "session_linked";

type TaskLedgerEvidenceRef = {
  type: "session" | "trace" | "file" | "memory" | "manual" | "tool" | "other";
  ref: string;
  label?: string;
};

type TaskLedgerNode = {
  id: string;
  title: string;
  kind: TaskLedgerNodeKind;
  parentId?: string | null;
  status: TaskLedgerNodeStatus;
  owner?: "user" | "agent" | "system";
  priority?: "low" | "normal" | "high";
  tags?: string[];
  description?: string;
  evidenceRefs?: TaskLedgerEvidenceRef[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

type TaskLedgerEventInput = {
  id?: string;
  type: TaskLedgerEventType;
  actor: "user" | "assistant" | "system";
  taskId?: string | null;
  sessionId?: string | null;
  idempotencyKey?: string | null;
  payload: {
    node?: TaskLedgerNode;
    nodeId?: string;
    sessionLink?: {
      id: string;
      nodeId?: string | null;
      sessionKey: string;
      agentId?: string | null;
      traceId?: string | null;
      relation?: "related" | "forked_from" | "handoff_from";
      sourceSessionKey?: string | null;
      summary?: string;
      createdAt: string;
    };
    reviewReason?: string;
    decision?: string;
    deviation?: string;
    note?: string;
  };
  createdAt?: string;
};

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

function taskLedgerEventsPath(workspaceId?: string | null): string {
  return join(
    resolveConfigDir(),
    "task-ledgers",
    "workspaces",
    normalizeTaskLedgerWorkspaceId(workspaceId),
    "events.jsonl",
  );
}

function nowIso(ms?: number): string {
  return new Date(ms ?? Date.now()).toISOString();
}

function eventAlreadyExists(pathname: string, idempotencyKey?: string | null): boolean {
  if (!idempotencyKey || !existsSync(pathname)) return false;
  try {
    return readFileSync(pathname, "utf8")
      .split(/\r?\n/u)
      .some((line) => {
        if (!line.trim()) return false;
        try {
          const parsed = JSON.parse(line) as { idempotencyKey?: unknown };
          return parsed.idempotencyKey === idempotencyKey;
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}

export function appendLongTaskLedgerEvents(
  workspaceId: string | null | undefined,
  inputs: TaskLedgerEventInput[],
): void {
  if (inputs.length === 0) return;
  const pathname = taskLedgerEventsPath(workspaceId);
  mkdirSync(dirname(pathname), { recursive: true });
  const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
  const events = inputs.flatMap((input): TaskLedgerEvent[] => {
    if (eventAlreadyExists(pathname, input.idempotencyKey)) return [];
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
    appendFileSync(pathname, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }
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
            taskLedgerRootId: rootId,
            sessionKey: input.sessionKey,
            agentId: input.agentId,
            runId: input.runId,
            source: input.source,
            ...(input.metadata ?? {}),
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
  ]);
  return rootId;
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
    if (ref.type === "clawgraph" || ref.type === "task_ledger") {
      out.push({ type: "other", ref: ref.ref, ...(ref.label ? { label: ref.label } : {}) });
    } else {
      out.push({ type: ref.type, ref: ref.ref, ...(ref.label ? { label: ref.label } : {}) });
    }
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
