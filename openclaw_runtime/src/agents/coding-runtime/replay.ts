/**
 * P4 UFTK: session replay.
 *
 * Replay returns the audit events for one session in the same order they were
 * appended to the JSONL audit stream (the authoritative execution order).
 * Complexity is linear in the number of JSONL events read.
 */
import type { AuditQuery, CodingAuditEvent } from "../../../../shared/coding-runtime/types.js";
import type { JsonlCodingAuditStore } from "./audit-log.js";

export type CodingSessionReplaySource = Pick<JsonlCodingAuditStore, "readEvents">;

export type CodingSessionReplayResult = {
  sessionId: string;
  events: CodingAuditEvent[];
  warnings: string[];
};

export async function replayCodingSession(
  sessionId: string,
  source: CodingSessionReplaySource,
  query: AuditQuery = {},
): Promise<CodingSessionReplayResult> {
  const { events, warnings } = await source.readEvents();
  const fromMs = query.fromMs ?? 0;
  const toMs = query.toMs ?? Number.POSITIVE_INFINITY;
  const matched = events.filter((event) => {
    if (event.sessionId !== sessionId) return false;
    if (event.timestamp < fromMs || event.timestamp > toMs) return false;
    if (query.toolName && event.toolName !== query.toolName) return false;
    if (query.path && event.path !== query.path) return false;
    return true;
  });
  return { sessionId, events: matched, warnings };
}

export async function replay(
  sessionId: string,
  source: CodingSessionReplaySource,
): Promise<CodingAuditEvent[]> {
  const result = await replayCodingSession(sessionId, source);
  return result.events;
}
