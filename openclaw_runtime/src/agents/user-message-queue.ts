import {
  claimPendingLongTaskUserMessages,
  clearLongTaskUserQueue,
  countLongTaskQueuedMessages,
  enqueueLongTaskUserMessage,
  markLongTaskUserMessagesDrained,
  markLongTaskUserMessagesFailed,
  restoreLongTaskUserMessages,
  type LongTaskQueuedUserMessage,
} from "./long-task-control/store.js";

export type QueuedUserMessage = {
  id: string;
  text: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  workspaceFingerprint?: string;
  taskLedgerRootId?: string;
  enqueuedAt: number;
  source: string;
  attempts?: number;
  lastError?: string;
};

type QueueDrainCallback = (sessionKey: string) => Promise<void>;
let drainCallback: QueueDrainCallback | undefined;

function toQueuedUserMessage(entry: LongTaskQueuedUserMessage): QueuedUserMessage {
  const workspaceFingerprint = typeof entry.payload.workspaceFingerprint === "string"
    ? entry.payload.workspaceFingerprint.trim() : undefined;
  return {
    id: entry.id,
    text: entry.text,
    sessionKey: entry.sessionKey,
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(workspaceFingerprint ? { workspaceFingerprint } : {}),
    ...(entry.taskLedgerRootId ? { taskLedgerRootId: entry.taskLedgerRootId } : {}),
    enqueuedAt: entry.enqueuedAt,
    source: entry.source,
    attempts: entry.attempts,
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  };
}

/** Register the drain callback called after an active run clears. */
export function setQueueDrainCallback(fn: QueueDrainCallback): void {
  drainCallback = fn;
}

export function triggerQueueDrain(sessionKey: string | undefined): void {
  if (!sessionKey || !drainCallback || peekUserMessageCount(sessionKey) === 0) return;
  void drainCallback(sessionKey).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    failDrainingUserMessages(sessionKey, message);
  });
}

export function enqueueUserMessage(
  sessionKey: string,
  msg: {
    text: string;
    agentId?: string;
    workspaceId?: string;
    workspaceFingerprint?: string;
    taskLedgerRootId?: string;
    source?: string;
    idempotencyKey?: string;
  },
): QueuedUserMessage {
  return toQueuedUserMessage(
    enqueueLongTaskUserMessage({
      sessionKey,
      text: msg.text,
      agentId: msg.agentId,
      workspaceId: msg.workspaceId,
      ...(msg.workspaceFingerprint ? { payload: { workspaceFingerprint: msg.workspaceFingerprint } } : {}),
      taskLedgerRootId: msg.taskLedgerRootId,
      source: msg.source,
      idempotencyKey: msg.idempotencyKey,
    }),
  );
}

/**
 * Claims pending messages for drain by moving them to `draining`.
 * Call `completeDrainedUserMessages`, `restoreDrainingUserMessages`, or
 * `failDrainingUserMessages` after the delivery attempt settles.
 */
export function drainUserMessages(sessionKey: string): QueuedUserMessage[] {
  return claimPendingLongTaskUserMessages(sessionKey).map(toQueuedUserMessage);
}

export function completeDrainedUserMessages(messages: QueuedUserMessage[]): void {
  markLongTaskUserMessagesDrained(messages.map((message) => message.id));
}

export function restoreDrainingUserMessages(messages: QueuedUserMessage[], reason: string): void {
  restoreLongTaskUserMessages(messages.map((message) => message.id), reason);
}

export function failDrainingUserMessages(
  messagesOrSessionKey: QueuedUserMessage[] | string,
  error: string,
): void {
  if (typeof messagesOrSessionKey === "string") {
    const messages = drainUserMessages(messagesOrSessionKey);
    markLongTaskUserMessagesFailed(messages.map((message) => message.id), error);
    return;
  }
  markLongTaskUserMessagesFailed(messagesOrSessionKey.map((message) => message.id), error);
}

export function peekUserMessageCount(sessionKey: string): number {
  return countLongTaskQueuedMessages(sessionKey);
}

export function clearUserMessageQueue(sessionKey: string): void {
  clearLongTaskUserQueue(sessionKey);
}
