/**
 * TF-0719: retry authorization for an interrupted tool call.
 *
 * When an execution phase is `dispatched`, the effect never started. The
 * transcript repair currently replaces the missing result with a synthetic
 * error, which tells the model "this failed" and loses the pending work.
 *
 * This module rewrites only those synthetic results into an explicit retry
 * authorization. It never touches a real tool result, never authorizes a call
 * whose phase is `effect_pending`/`effect_committed`, and never invents one.
 */

export const RETRY_AUTHORIZED_TEXT =
  '[openclaw] retry-authorized: the previous attempt did not start an external effect; re-issue this tool call with the same arguments.';

export const SYNTHETIC_MISSING_TOOL_RESULT_TEXT =
  '[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.';

type AnyMessage = Record<string, unknown>;

function isSyntheticMissingResult(message: AnyMessage): boolean {
  if (message.role !== 'toolResult') return false;
  const details = message.details;
  if (details && typeof details === 'object' && (details as Record<string, unknown>).openclawSyntheticMissingToolResult === true) {
    return true;
  }
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      (block as { text?: string }).text === SYNTHETIC_MISSING_TOOL_RESULT_TEXT,
  );
}

export type PendingToolCall = { toolCallId: string; toolName: string };

/** Tool calls whose only result is the synthetic "missing result" marker. */
export function findRetryableToolCalls(messages: unknown[]): PendingToolCall[] {
  const pending: PendingToolCall[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as AnyMessage;
    if (!isSyntheticMissingResult(message)) continue;
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
    if (!toolCallId) continue;
    pending.push({
      toolCallId,
      toolName: typeof message.toolName === 'string' ? message.toolName : 'unknown',
    });
  }
  return pending;
}

/**
 * Replace the synthetic error with a retry authorization for the given ids.
 * Returns a new array; unrelated messages are passed through unchanged.
 */
export function markRetryAuthorized(
  messages: unknown[],
  authorizedToolCallIds: ReadonlySet<string>,
): { messages: unknown[]; authorized: number } {
  let authorized = 0;
  const next = messages.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const message = raw as AnyMessage;
    if (!isSyntheticMissingResult(message)) return raw;
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
    if (!toolCallId || !authorizedToolCallIds.has(toolCallId)) return raw;
    authorized += 1;
    return {
      ...message,
      content: [{ type: 'text', text: RETRY_AUTHORIZED_TEXT }],
      details: {
        ...(message.details && typeof message.details === 'object' ? message.details as Record<string, unknown> : {}),
        openclawRetryAuthorized: true,
      },
      isError: false,
    };
  });
  return { messages: next, authorized };
}

/** Only `dispatched` rows mean "the effect never started". */
export function authorizedToolCallIds(rows: Array<{ phase: string; intent_json?: string | null }>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.phase !== 'dispatched') continue;
    try {
      const intent = JSON.parse(String(row.intent_json ?? '{}')) as { toolCallId?: unknown };
      if (typeof intent.toolCallId === 'string' && intent.toolCallId) ids.add(intent.toolCallId);
    } catch {
      // ignore malformed intent
    }
  }
  return ids;
}
