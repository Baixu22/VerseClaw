/**
 * TaskNodeSelector — compact dropdown for selecting the active Task Ledger node
 * in the chat composer. Shows todo/doing tasks from the current workspace.
 */
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ListTodo } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import type { TaskLedgerNode } from '@shared/types/task-ledger';

const ACTIVE_STATUSES = new Set(['todo', 'doing']);

function activeTasks(nodes: TaskLedgerNode[]): TaskLedgerNode[] {
  return nodes
    .filter((n) => ACTIVE_STATUSES.has(n.status))
    .sort((a, b) => {
      const statusOrder = (s: string) => (s === 'doing' ? 0 : 1);
      return statusOrder(a.status) - statusOrder(b.status);
    })
    .slice(0, 20);
}

interface TaskNodeSelectorProps {
  selectedTaskNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
}

export function TaskNodeSelector({ selectedTaskNodeId, onSelect }: TaskNodeSelectorProps) {
  const { t } = useTranslation();
  const taskLedgerSnapshot = useChatStore((s) => s.taskLedgerSnapshot);
  const taskLedgerLoaded = useChatStore((s) => s.taskLedgerLoaded);

  const tasks = useMemo(
    () => (taskLedgerSnapshot ? activeTasks(taskLedgerSnapshot.nodes) : []),
    [taskLedgerSnapshot],
  );

  const selectedTitle = useMemo(() => {
    if (!selectedTaskNodeId || !taskLedgerSnapshot) return null;
    return taskLedgerSnapshot.nodes.find((n) => n.id === selectedTaskNodeId)?.title ?? null;
  }, [selectedTaskNodeId, taskLedgerSnapshot]);

  const handleToggle = useCallback(
    (nodeId: string) => {
      onSelect(selectedTaskNodeId === nodeId ? null : nodeId);
    },
    [selectedTaskNodeId, onSelect],
  );

  const handleClear = useCallback(() => onSelect(null), [onSelect]);

  if (!taskLedgerLoaded) return null;
  if (tasks.length === 0 && !selectedTaskNodeId) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1" data-testid="task-node-selector">
      <ListTodo className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {selectedTaskNodeId && selectedTitle ? (
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-tiny text-primary hover:bg-primary/20 transition-colors max-w-[200px]"
          title={selectedTitle}
        >
          <span className="truncate">{selectedTitle}</span>
          <span className="text-[10px] opacity-60">&times;</span>
        </button>
      ) : (
        <div className="relative group">
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-tiny text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="task-node-selector-trigger"
          >
            <span className="hidden sm:inline">{t('taskLedger:summary.title', 'Active Task')}</span>
            <span className="text-[10px] opacity-40">{tasks.length}</span>
          </button>
          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50 w-64 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
            <div className="p-1">
              {tasks.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => handleToggle(node.id)}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                  data-testid={`task-node-selector-option-${node.id}`}
                >
                  <div className="mt-0.5 shrink-0">
                    {selectedTaskNodeId === node.id ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/90">{node.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                        node.status === 'doing' ? 'bg-blue-500' : 'bg-amber-500'
                      }`} />
                      <span className="text-tiny text-muted-foreground">
                        {node.kind} &middot; {node.status}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
