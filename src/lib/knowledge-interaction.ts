/** Cancellation only settles this optional read; the Host keeps its own bounded deadline. */
export function boundedKnowledgeRead<T>(request: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<{ result?: T; reason: 'complete' | 'cancelled' | 'timeout' | 'error' }> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: { result?: T; reason: 'complete' | 'cancelled' | 'timeout' | 'error' }) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(value);
    };
    const cancel = () => finish({ reason: 'cancelled' });
    const timer = setTimeout(() => finish({ reason: 'timeout' }), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    request.then(result => finish({ result, reason: 'complete' }), () => finish({ reason: 'error' }));
  });
}

export function knowledgeRequestKey(session: string, workspace: string | undefined, scope: string, mode: string, profile: string, query: string) {
  return JSON.stringify([session, workspace, scope, mode, profile, query.trim()]);
}
