/**
 * TopicSelector — Dropdown for selecting active topic within a workspace
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, ChevronDown, Settings2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TopicEntry } from '@shared/host-api/contract';

interface TopicSelectorProps {
  topics: TopicEntry[];
  activeTopicId?: string | null;
  onSelectTopic: (topicId: string | null) => void;
  onManageTopics: () => void;
}

export function TopicSelector({ topics, activeTopicId, onSelectTopic, onManageTopics }: TopicSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeTopic = useMemo(() => topics.find((t) => t.id === activeTopicId), [topics, activeTopicId]);

  const tooltipText = activeTopic
    ? `当前主题: ${activeTopic.name}${activeTopic.description ? ` — ${activeTopic.description}` : ''}`
    : '全局模式，使用工作区全局记忆';

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0" data-testid="chat-topic-selector">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button"
            data-testid="chat-topic-selector-button"
            className="inline-flex max-w-[160px] items-center gap-1 rounded-md px-1.5 py-1 font-medium text-foreground/70 transition-colors hover:bg-black/5 dark:hover:bg-white/10 text-sm"
            onClick={() => setOpen((v) => !v)}>
            <Folder className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{activeTopic ? activeTopic.name : '无主题'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
      {open && (
        <div data-testid="chat-topic-selector-menu" className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
          <button key="_none" type="button"
            className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${!activeTopicId ? 'bg-black/5 dark:bg-white/10' : ''}`}
            onClick={() => { onSelectTopic(null); setOpen(false); }}>
            <span className="text-sm font-medium text-foreground">全局（无主题）</span>
            <span className="text-[11px] text-muted-foreground">使用全局记忆和工作区上下文</span>
          </button>
          {topics.map((topic) => (
            <button key={topic.id} type="button"
              className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${topic.id === activeTopicId ? 'bg-black/5 dark:bg-white/10' : ''}`}
              onClick={() => { onSelectTopic(topic.id); setOpen(false); }}>
              <span className="truncate text-sm font-medium text-foreground">{topic.name}</span>
              {topic.description && (
                <span className="truncate font-mono text-[11px] text-muted-foreground">{topic.description}</span>
              )}
            </button>
          ))}
          {topics.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">暂无主题</div>}
          <div className="mt-1 border-t border-black/5 dark:border-white/5">
            <button type="button"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => { setOpen(false); onManageTopics(); }}>
              <Settings2 className="h-3.5 w-3.5" />管理主题...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
