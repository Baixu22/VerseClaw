import { ArrowRight, FileText, Inbox, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { KnowledgeReviewItem, KnowledgeReviewKind } from '@/lib/knowledge-review-items';

const ICONS = { inbox: Inbox, draft: FileText, proposal: ShieldCheck };
export type KnowledgeReviewFilter = KnowledgeReviewKind | 'all';

export function KnowledgeReviewQueue({ items, filter, query, onFilterChange, onQueryChange, onSelect }: {
  items: KnowledgeReviewItem[];
  filter: KnowledgeReviewFilter;
  query: string;
  onFilterChange: (filter: KnowledgeReviewFilter) => void;
  onQueryChange: (query: string) => void;
  onSelect: (item: KnowledgeReviewItem) => void;
}) {
  const { t } = useTranslation('knowledge');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = items.filter((item) => (filter === 'all' || item.kind === filter)
    && (!normalizedQuery || `${item.title} ${item.summary}`.toLocaleLowerCase().includes(normalizedQuery)));
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="knowledge-review-queue">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('reviewQueue.filterLabel')}>
          {(['all', 'inbox', 'draft', 'proposal'] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={filter === kind}
              className={cn('h-8 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5', filter === kind && 'bg-black/5 dark:bg-white/10 text-foreground')}
              data-testid={`knowledge-review-filter-${kind}`} onClick={() => onFilterChange(kind)}>
              {t(`reviewQueue.filters.${kind}`)}
              <span className="ml-1.5 tabular-nums">{kind === 'all' ? items.length : items.filter((item) => item.kind === kind).length}</span>
            </button>
          ))}
        </div>
        <Input value={query} onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('reviewQueue.search')} aria-label={t('reviewQueue.search')}
          className="ml-auto h-8 w-full rounded-lg border-border/60 bg-surface-input sm:w-60" data-testid="knowledge-review-search" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t('reviewQueue.empty')}</p>}
        {visible.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <button key={item.key} type="button" onClick={() => onSelect(item)}
              className="knowledge-press flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5"
              data-testid="knowledge-review-item" data-item-key={item.key}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.summary}</span>
                <span className="mt-2 flex flex-wrap items-center gap-2 text-tiny text-muted-foreground">
                  <span>{t(`reviewQueue.filters.${item.kind}`)}</span>
                  <Badge variant="outline" className="rounded-full border-border/60 bg-transparent text-2xs font-normal text-muted-foreground">{t(`reviewQueue.status.${item.status}`)}</Badge>
                </span>
              </span>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
