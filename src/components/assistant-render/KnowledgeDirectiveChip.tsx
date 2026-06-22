import { BookOpen, Archive, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ChatKnowledgeReference } from '@/lib/host-api';

const corpusConfig: Record<string, { icon: typeof BookOpen; color: string }> = {
  wiki: { icon: BookOpen, color: 'emerald' },
  memory: { icon: Archive, color: 'amber' },
  all: { icon: BookOpen, color: 'blue' },
};

export function KnowledgeDirectiveChip({
  reference,
  onRemove,
  size = 'sm',
}: {
  reference: ChatKnowledgeReference;
  onRemove?: () => void;
  size?: 'sm' | 'xs';
}) {
  const { t } = useTranslation('chat');
  const corpus = reference.corpus || 'wiki';
  const config = corpusConfig[corpus] || corpusConfig.wiki;
  const Icon = config.icon;
  const isXs = size === 'xs';

  return (
    <span
      className={cn(
        'inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-meta font-medium transition-colors',
        config.color === 'emerald' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        config.color === 'amber' && 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        config.color === 'blue' && 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400',
        isXs && 'px-1.5 py-0.5 text-2xs',
      )}
      title={t('composer.knowledgeAttach.messageRefTitle', { title: reference.title })}
    >
      <Icon className={cn('shrink-0', isXs ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
      <span className="truncate">{reference.title}</span>
      {reference.lookup && (
        <span className={cn('ml-0.5 truncate opacity-60', isXs ? 'hidden' : 'hidden sm:inline')}>
          @{reference.lookup}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

export function extractDirectivesFromText(text: string): Array<{
  type: 'wiki' | 'memory' | 'all';
  query: string;
  full: string;
}> {
  const directives: Array<{ type: 'wiki' | 'memory' | 'all'; query: string; full: string }> = [];
  const pattern = /\/(wiki|memory|all)\s+([^\n]*?)(?=\s*\/|\s*$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const type = match[1].toLowerCase() as 'wiki' | 'memory' | 'all';
    const query = match[2].trim();
    if (query) {
      directives.push({ type, query, full: match[0].trim() });
    }
  }
  return directives;
}

export function stripDirectivesFromText(text: string): string {
  return text.replace(/\/(wiki|memory|all)\s+([^\n]*?)(?=\s*\/|\s*$)/gi, '').trim();
}
