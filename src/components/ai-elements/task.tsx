import { CheckSquare, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AiElementCard } from './card';

export type TaskFile = {
  path: string;
  status?: string;
};

export type TaskItem = {
  label: string;
  detail?: string;
  files?: TaskFile[];
};

export type TaskProps = {
  title: string;
  defaultOpen?: boolean;
  items: TaskItem[];
  onOpenFile?: (path: string) => void;
};

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

function statusClass(status: string | undefined): string {
  const normalized = (status ?? '').toLowerCase();
  if (['created', 'added', 'new', 'complete', 'completed'].includes(normalized)) return 'text-green-700 dark:text-green-400';
  if (['modified', 'updated', 'active'].includes(normalized)) return 'text-blue-700 dark:text-blue-400';
  if (['deleted', 'removed', 'failed'].includes(normalized)) return 'text-red-700 dark:text-red-400';
  return 'text-muted-foreground';
}

export function Task({ title, defaultOpen = true, items, onOpenFile }: TaskProps) {
  const { t } = useTranslation('chat');

  return (
    <AiElementCard
      icon={<CheckSquare className="h-3.5 w-3.5" />}
      label={t('toolUi.task.label', 'Task')}
      data-testid="chat-tool-ui-task"
    >
      <Collapsible
        defaultOpen={defaultOpen}
        title={title}
        subtitle={t('toolUi.task.itemCount', '{{count}} items', { count: items.length })}
        className="bg-surface-input"
      >
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('toolUi.task.empty', 'No task items were reported.')}</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`} className="rounded-md border border-border bg-background/70 p-2.5" data-testid="ai-task-item">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                {item.detail ? <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.detail}</p> : null}
                {item.files?.length ? (
                  <div className="mt-2 space-y-1">
                    {item.files.map((file, fileIndex) => (
                      <button
                        key={`${file.path}-${fileIndex}`}
                        type="button"
                        className={cn(
                          'flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface-input px-2 py-1.5 text-left text-xs',
                          onOpenFile && 'hover:bg-black/5 dark:hover:bg-white/10',
                        )}
                        onClick={() => onOpenFile?.(file.path)}
                        title={file.path}
                        data-testid="ai-task-file"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono text-foreground">{basename(file.path)}</span>
                        {file.status ? <span className={cn('shrink-0 text-2xs', statusClass(file.status))}>{file.status}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Collapsible>
    </AiElementCard>
  );
}
