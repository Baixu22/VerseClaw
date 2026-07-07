import { BookOpenCheck, RefreshCw, FolderTree, ListTree, PanelTop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_BROWSER_ENABLED } from '@/components/file-preview/workspace-browser-config';
import { useMemo } from 'react';

type ChatToolbarProps = {
  questionDirectoryOpen?: boolean;
  questionDirectoryCount?: number;
  workContextVisible?: boolean;
  onToggleWorkContext?: () => void;
  onToggleQuestionDirectory?: () => void;
  onSaveToKnowledge?: () => void;
};

export function ChatToolbar({
  questionDirectoryOpen = false,
  questionDirectoryCount = 0,
  workContextVisible = true,
  onToggleWorkContext,
  onToggleQuestionDirectory,
  onSaveToKnowledge,
}: ChatToolbarProps = {}) {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const openBrowser = useArtifactPanel((s) => s.openBrowser);
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelTab = useArtifactPanel((s) => s.tab);
  const closePanel = useArtifactPanel((s) => s.close);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen && panelTab === 'browser';
  const questionDirectoryAvailable = questionDirectoryCount > 1 && !!onToggleQuestionDirectory;
  const workContextAvailable = !!onToggleWorkContext;

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-work-context-toggle"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              workContextVisible && 'bg-foreground/10 text-foreground',
            )}
            onClick={onToggleWorkContext}
            disabled={!workContextAvailable}
            aria-label={t('toolbar.workContext')}
            aria-pressed={workContextVisible}
          >
            <PanelTop className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.workContext')}</p>
        </TooltipContent>
      </Tooltip>
      {WORKSPACE_BROWSER_ENABLED && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="chat-workspace-toggle"
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                browserActive && 'bg-foreground/10 text-foreground',
              )}
              onClick={() => (browserActive ? closePanel() : openBrowser())}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace')}
            >
              <FolderTree className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.workspace')}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-save-knowledge"
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={onSaveToKnowledge}
            disabled={!onSaveToKnowledge}
            aria-label={t('toolbar.saveToKnowledge')}
          >
            <BookOpenCheck className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.saveToKnowledge')}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-question-directory-toggle"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              questionDirectoryOpen && 'bg-foreground/10 text-foreground',
            )}
            onClick={onToggleQuestionDirectory}
            disabled={!questionDirectoryAvailable}
            aria-label={t('questionDirectory.title')}
          >
            <ListTree className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('questionDirectory.title')}</p>
        </TooltipContent>
      </Tooltip>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
