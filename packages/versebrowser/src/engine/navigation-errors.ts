/** Only read failures caused by a document being replaced are retryable. */
export function isNavigationReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as {code?:unknown} | null)?.code;
  if (typeof code === 'string' && code.startsWith('E_')) return code === 'E_PAGE_NOT_READY';
  return /Execution context was destroyed|Cannot find context with specified id|Cannot find default execution context|E_PAGE_NOT_READY/u.test(message);
}

/** Advice only: callers still own retry decisions; side effects are never replayable here. */
export function recoveryHint(error: unknown, readOnly: boolean) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as {code?:unknown} | null)?.code;
  const signal = typeof code === 'string' && code.startsWith('E_') ? code : message;
  const category = /E_NEED_CONFIRM|E_HITL_PAUSED/.test(signal) ? 'needs_user'
    : /E_CANCELLED|E_ABORTED/.test(signal) ? 'cancelled'
    : /E_CAPABILITY_DENY|E_GROUP_DENY|E_TOOL_DENY|E_AUDIT_/.test(signal) ? 'denied'
    : /E_NOT_IMPLEMENTED|E_TOOL_NOT_EXPOSED/.test(signal) ? 'unsupported'
    : /E_PAGE_CLOSED|E_UPSTREAM_CLOSED|E_NO_SESSION|Target page, context or browser has been closed/.test(signal) ? 'closed'
    : /E_STALE_REF|E_STALE_CURSOR/.test(signal) ? 'stale'
    : /E_AMBIGUOUS|strict mode violation/.test(signal) ? 'ambiguous'
    : /E_FIELD_READONLY|E_TARGET_UNAVAILABLE/.test(signal) ? 'blocked'
    : /E_WAIT_COLLECTION|E_EXTRACTION_RESULT/.test(signal) ? 'collection_failed'
    : /timeout|timed out|E_.*TIMEOUT/i.test(signal) ? 'timeout'
    : isNavigationReadError(signal) ? 'navigation_transient' : 'unknown';
  return { category, retryable: readOnly && category === 'navigation_transient',
    reobserve: ['stale','ambiguous','blocked','collection_failed','timeout','navigation_transient','unknown'].includes(category),
    needs_user: category === 'needs_user', execution: readOnly ? 'read_only' : 'may_have_side_effects' };
}
