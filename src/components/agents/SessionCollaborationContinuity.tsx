import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { SessionCollaborationHints } from '@shared/types/session-collaboration-hints';
import type { TaskCollaborationContinuity } from '@shared/types/session-collaboration-continuity';
import { SessionCollaborationMaterials } from './SessionCollaborationMaterials';

export function SessionCollaborationContinuity({ hints, openSession }: { hints: SessionCollaborationHints; openSession?: () => void }) {
  const { t } = useTranslation('agents');
  const [selected, setSelected] = useState<TaskCollaborationContinuity['materials'][number] | null>(null);
  const transitions = hints.task?.continuity ?? [];
  const operations = hints.continuityOperations ?? [];
  const currentSelection = selected && transitions.some(item => item.materials.some(material => JSON.stringify(material) === JSON.stringify(selected)));
  if (!transitions.length && !operations.length) return null;
  return <section className="space-y-3 border-t border-border pt-3" data-testid="collaboration-continuity">
    <h4 className="font-medium">{t('collaboration.continuity.title')}</h4>
    <p className="text-xs text-muted-foreground">{t('collaboration.continuity.description')}</p>
    {transitions.map((item, index) => <div key={`${item.sourceGeneration}:${index}`} className="space-y-1 break-all text-xs">
      <p>{t(`collaboration.continuity.kind.${item.kind}`)} · {item.sourceSessionKey} · {item.sourceGeneration}</p>
      <p>{t('collaboration.continuity.task', { id: item.task.taskNodeId, revision: item.task.revision })}</p>
      {item.truncated && <p>{t('collaboration.continuity.bounded')}</p>}
      {item.materials.map(material => <Button key={JSON.stringify(material.ref)} type="button" variant="outline"
        className="mr-2 h-auto min-h-11 max-w-full whitespace-normal break-all text-left text-xs sm:min-h-9"
        onClick={() => setSelected(material)}>{t('collaboration.continuity.material', { id: material.ref.id, version: material.ref.version })}</Button>)}
    </div>)}
    {operations.map(operation => <div key={`${operation.kind}:${operation.id}`} className="space-y-1 break-all text-xs" data-operation-id={operation.id}>
      <p>{t(`collaboration.continuity.kind.${operation.kind}`)} · {t(`collaboration.continuity.phase.${operation.phase}`)}</p>
      <p>{operation.id}</p>
      <p>{operation.sourceSessionKey} · {operation.sourceGeneration} → {operation.sessionKey} · {operation.generation ?? t('collaboration.continuity.pending')}</p>
      {operation.draftRetained && <p>{t('collaboration.continuity.draftRetained')}</p>}
      {operation.firstSendIdempotencyKey && <p>{t('collaboration.continuity.firstSend')} · {operation.firstSendIdempotencyKey}</p>}
      {operation.run && <p>{t('collaboration.fields.run')} · {operation.run.runId}</p>}
      {operation.sourceCheckout && <p>{t('collaboration.continuity.checkout')} · {operation.sourceCheckout} → {operation.targetCheckout}</p>}
    </div>)}
    {openSession && operations.length > 0 && <Button type="button" variant="outline" className="h-11 sm:h-9"
      onClick={openSession}>{t('collaboration.continuity.open')}</Button>}
    {selected && currentSelection && <SessionCollaborationMaterials key={JSON.stringify(selected)} target={selected.source} reference={selected} />}
  </section>;
}
