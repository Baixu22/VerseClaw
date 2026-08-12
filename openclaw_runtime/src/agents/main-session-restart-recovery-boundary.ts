/** Pure transcript boundary used by Gateway restart recovery and its tests. */

function getMessageRole(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : undefined;
}

function isMeaningfulTailMessage(message: unknown): boolean {
  const role = getMessageRole(message);
  return Boolean(role && role !== "system");
}

function isResumableTailMessage(message: unknown): boolean {
  const role = getMessageRole(message);
  if (role === "user" || role === "tool" || role === "toolResult") {
    return true;
  }
  if (role !== "assistant" || !message || typeof message !== "object") {
    return false;
  }

  // Gateway shutdown aborts the active provider turn after the latest
  // assistant message has been persisted. Those assistant records are the
  // recoverable in-flight boundary; replaying only terminal turns would
  // duplicate a completed response.
  const stopReason = (message as { stopReason?: unknown }).stopReason;
  return stopReason === "aborted" || stopReason === "toolUse";
}

function isApprovalPendingToolResult(message: unknown): boolean {
  if (!message || typeof message !== "object" || getMessageRole(message) !== "toolResult") {
    return false;
  }
  const details = (message as { details?: unknown }).details;
  return Boolean(
    details &&
    typeof details === "object" &&
    (details as { status?: unknown }).status === "approval-pending",
  );
}

export function resolveMainSessionResumeBlockReason(messages: unknown[]): string | null {
  const lastMeaningful = messages.toReversed().find(isMeaningfulTailMessage);
  if (!lastMeaningful || !isResumableTailMessage(lastMeaningful)) {
    return "transcript tail is not resumable";
  }
  if (isApprovalPendingToolResult(lastMeaningful)) {
    return "transcript tail is a stale approval-pending tool result";
  }
  return null;
}
