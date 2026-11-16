import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTodo } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';

export function TaskNodeSelector({ selectedTaskNodeId, onSelect, busy = false }: {
  selectedTaskNodeId: string | null;
  onSelect: (nodeId: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation('taskLedger');
  const snapshot = useChatStore((state) => state.taskLedgerSnapshot);
  const loaded = useChatStore((state) => state.taskLedgerLoaded);
  const workspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const tasks = useMemo(() => snapshot && snapshot.sourceWorkspaceId === workspaceId
    ? snapshot.nodes.filter((node) => node.kind === 'task' && (['todo', 'doing'].includes(node.status) || node.id === selectedTaskNodeId))
      .toSorted((left, right) => Number(right.id === selectedTaskNodeId) - Number(left.id === selectedTaskNodeId))
      .slice(0, 20)
    : [], [snapshot, workspaceId, selectedTaskNodeId]);
  if (!loaded || !tasks.length) return null;
  return <label className="flex min-w-0 items-center gap-1.5 px-2 py-1" data-testid="task-node-selector">
    <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
    <select data-testid="task-node-selector-trigger" aria-label={t('summary.sessionTasks')}
      value={selectedTaskNodeId ?? ''} disabled={busy}
      onChange={(event) => { if (event.target.value) onSelect(event.target.value); }}
      className="min-w-0 max-w-52 rounded bg-surface-input px-1.5 py-1 text-xs">
      <option value="" disabled>{t('summary.select')}</option>
      {tasks.map((node) => <option key={node.id} value={node.id} data-testid={`task-node-selector-option-${node.id}`}>
        {node.title} · {t(`status.${node.status}`)}
      </option>)}
    </select>
  </label>;
}
