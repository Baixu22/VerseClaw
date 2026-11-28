import { hostApi } from './host-api';
import type { KnowledgeResearchPayload, ResearchResultV1 } from '@shared/knowledge/research';
import { boundedKnowledgeRead } from './knowledge-interaction';

/** The request ID exists before start, so cancellation also fences owner setup and late acceptance. */
export async function readKnowledgeResearch(input: Omit<KnowledgeResearchPayload, 'requestId'>, signal: AbortSignal,
  onUpdate: (result: ResearchResultV1) => void, failureMessage: string): Promise<{ result?: ResearchResultV1; reason: 'complete' | 'cancelled' | 'timeout' | 'error' }> {
  const request = { ...input, requestId: crypto.randomUUID() };
  const selected = { requestId: request.requestId, sessionKey: request.sessionKey, workspaceId: request.workspaceId };
  const deadline = Date.now() + 30000;
  let latest: ResearchResultV1 | undefined;
  let stopped = false;
  const cancel = () => { stopped = true; void hostApi.knowledge.researchCancel(selected).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const finishPartial = async (reason: 'cancelled' | 'timeout' | 'error') => {
    cancel();
    // Observe the owner stop without extending any retrieval or model budget.
    const response = await boundedKnowledgeRead(hostApi.knowledge.researchStatus(selected), new AbortController().signal, 1500);
    if (!response.result?.success) throw new Error(response.result?.error || failureMessage);
    if (signal.aborted) reason = 'cancelled';
    if (!response.result.research) return { reason };
    latest = response.result.research;
    if (latest && latest.stopReason !== 'scope-changed' && (latest.phase !== 'finished' || reason === 'cancelled' || reason === 'timeout')) latest = { ...latest, phase: 'finished',
      status: reason === 'cancelled' ? 'cancelled' : latest.evidence.length ? 'partial' : 'unavailable',
      stopReason: reason === 'cancelled' ? 'cancelled' : reason === 'timeout' ? 'deadline' : 'unavailable' };
    if (latest) onUpdate(latest);
    return { result: latest, reason };
  };
  try {
    if (signal.aborted) return { reason: 'cancelled' };
    const acceptance = hostApi.knowledge.researchStart(request);
    // Cancellation can precede Main admission; repeat it when the late start settles.
    void acceptance.then(() => { if (stopped) cancel(); }, () => undefined);
    const start = await boundedKnowledgeRead(acceptance, signal, Math.max(1, deadline - Date.now()));
    if (signal.aborted) return await finishPartial('cancelled');
    if (Date.now() >= deadline) return await finishPartial('timeout');
    if (!start.result) return await finishPartial(start.reason === 'complete' ? 'error' : start.reason);
    if (!start.result.success) throw new Error(start.result.error || failureMessage);
    latest = start.result.research;
    if (latest) onUpdate(latest);
    while (true) {
      if (signal.aborted) return await finishPartial('cancelled');
      if (Date.now() >= deadline) return await finishPartial('timeout');
      if (latest?.phase === 'finished') return { result: latest,
        reason: latest.status === 'cancelled' ? 'cancelled' : latest.stopReason === 'deadline' ? 'timeout' : 'complete' };
      const status = await boundedKnowledgeRead(hostApi.knowledge.researchStatus(selected), signal, Math.max(1, deadline - Date.now()));
      if (signal.aborted) return await finishPartial('cancelled');
      if (Date.now() >= deadline) return await finishPartial('timeout');
      if (!status.result) return await finishPartial(status.reason === 'complete' ? 'error' : status.reason);
      if (!status.result.success) throw new Error(status.result.error || failureMessage);
      if (status.result.research) { latest = status.result.research; onUpdate(latest); }
      if (latest?.phase !== 'finished') await boundedKnowledgeRead(new Promise<void>(resolve => setTimeout(resolve, 250)), signal, 300);
    }
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); }
}
