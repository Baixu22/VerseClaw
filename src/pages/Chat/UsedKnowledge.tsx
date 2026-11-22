import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApi, type ChatKnowledgeReference } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import type { RetainedEvidenceManifestV1 } from '@shared/knowledge/packing';
import { boundedKnowledgeRead } from '@/lib/knowledge-interaction';

export function UsedKnowledge({ runId, references, requestedCount = references.length }: {
  runId?: string; references: ChatKnowledgeReference[]; requestedCount?: number;
}) {
  const { t } = useTranslation('chat');
  const sending = useChatStore(state => state.sending);
  const active = useChatStore(state => state.activeRunId);
  const [loaded, setLoaded] = useState<{ runId?: string; receipt?: RetainedEvidenceManifestV1 | null }>({});
  const receipt = loaded.runId === runId ? loaded.receipt : undefined;
  const hasKnowledge = requestedCount > 0 || references.length > 0;
  useEffect(() => {
    if (!hasKnowledge || receipt !== undefined || (sending && (!runId || active === runId))) return;
    if (!runId) { setLoaded({ runId, receipt: null }); return; }
    const controller = new AbortController();
    void (async () => {
      // A terminal UI event can precede the Gateway's final snapshot publication.
      for (let attempt = 0; attempt < 4; attempt++) {
        const read = await boundedKnowledgeRead(hostApi.gateway.rpc('agent.wait', { runId, timeoutMs: 1000 }), controller.signal, 2000);
        if (controller.signal.aborted) return;
        const result = read.result as { status?: string; retainedEvidence?: RetainedEvidenceManifestV1 } | undefined;
        if (result?.retainedEvidence?.schema === 'RetainedEvidenceManifest/v1' && result.status !== 'timeout') {
          setLoaded({ runId, receipt: result.retainedEvidence });
          return;
        }
        if (read.reason !== 'complete') break;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!controller.signal.aborted) setLoaded({ runId, receipt: null });
    })();
    return () => controller.abort();
  }, [runId, sending, active, hasKnowledge, receipt]);
  if (!hasKnowledge) return null;
  const citations = receipt?.units.flatMap(unit => unit.citations) ?? [];
  const retainedReferences = citations.map(citation => {
    const exact = references.find(ref => ref.id === (citation.intentId ?? citation.refId));
    if (exact || citation.intentId) return exact;
    const matches = references.filter(ref => ref.lookup === citation.sourceRef.subjectId);
    return matches.length === 1 ? matches[0] : undefined;
  });
  const retainedRequests = new Set(retainedReferences.flatMap(ref => ref ? [ref.id] : [])).size;
  const selectionMapped = retainedReferences.every(ref => ref !== undefined);
  return <div className="text-right text-tiny text-muted-foreground" data-testid="chat-used-knowledge">
    {receipt ? <>
      <span>{t('knowledgeUsage.summary', { count: citations.length, chars: receipt.retainedChars, tokens: receipt.estimatedTokens })}</span>
      {!selectionMapped ? <span className="ml-2">{t('knowledgeUsage.selectionUnavailable')}</span>
        : requestedCount > retainedRequests && <span className="ml-2">{t('knowledgeUsage.dropped', { count: requestedCount - retainedRequests })}</span>}
      <span className="ml-2" data-testid="chat-used-knowledge-sources">{citations.map((citation, index) => retainedReferences[index]?.title ?? citation.sourceRef.subjectId).join(', ')}</span>
    </> : receipt === null ? t('knowledgeUsage.unavailable') : t('knowledgeUsage.pending')}
  </div>;
}
