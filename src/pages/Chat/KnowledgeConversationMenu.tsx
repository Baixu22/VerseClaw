import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { knowledgeHistory } from '../Knowledge/knowledge-conversations';
import type { KnowledgeChatContext } from './KnowledgeChat';

export function KnowledgeConversationMenu({ workspaceId, onOpen }: {
  workspaceId: string | null;
  onOpen: (context: KnowledgeChatContext) => void;
}) {
  const { t } = useTranslation('knowledge');
  const [rows, setRows] = useState<ReturnType<typeof knowledgeHistory>>([]);
  const action = 'block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10';
  return <details className="border-t border-border px-2.5 py-2 text-xs"
    onToggle={event => { if (event.currentTarget.open) setRows(knowledgeHistory(workspaceId)); }}>
    <summary className="cursor-pointer font-medium" data-testid="chat-knowledge-history">{t('conversation.history')}</summary>
    <div className="mt-1 max-h-44 overflow-auto">
      <button type="button" className={action} onClick={() => onOpen({ workspaceId })}>{t('conversation.openAssistant')}</button>
      {rows.map(row => <button key={row.key} type="button" className={action} title={row.title}
        data-testid="chat-knowledge-history-item" onClick={() => onOpen(row.context)}>
        {row.context.sourceSetTitle && <span className="mr-1 text-muted-foreground">{row.context.sourceSetTitle} ·</span>}
        {row.title}
      </button>)}
    </div>
  </details>;
}
