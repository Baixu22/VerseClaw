/**
 * Tool result helpers used by agent-browser tool tests.
 * Extracted from openclaw_runtime/src/agents/embedded-agent-subscribe.tools.ts
 * `isToolResultError` (source lines 543-549) and its status readers
 * (source lines 319-332).
 */
function normalizeOptionalLowercaseString(raw?: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized || undefined;
}

function readToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  return record.details && typeof record.details === "object" && !Array.isArray(record.details)
    ? (record.details as Record<string, unknown>)
    : undefined;
}

function readToolResultStatus(result: unknown): string | undefined {
  const status = readToolResultDetails(result)?.status;
  return normalizeOptionalLowercaseString(status);
}

export function isToolResultError(result: unknown): boolean {
  const normalized = readToolResultStatus(result);
  if (!normalized) {
    return false;
  }
  return normalized === "error" || normalized === "timeout";
}
