import type { ReactNode } from 'react';
import { Globe, Loader2, MonitorUp, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function WebPreviewRoot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)} data-testid="ai-web-preview">
      {children}
    </div>
  );
}

export function WebPreviewToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-border bg-surface-modal px-3 py-2" data-testid="ai-web-preview-toolbar">
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function WebPreviewModeTabs<TMode extends string>({
  modes,
  value,
  onChange,
  labelForMode,
}: {
  modes: readonly TMode[];
  value: TMode;
  onChange: (mode: TMode) => void;
  labelForMode: (mode: TMode) => string;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-md border border-border bg-surface-input p-0.5" data-testid="ai-web-preview-mode-tabs">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn(
            'rounded px-2 py-1 text-2xs transition-colors',
            value === mode ? 'bg-black/5 text-foreground shadow-sm dark:bg-white/10' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(mode)}
        >
          {labelForMode(mode)}
        </button>
      ))}
    </div>
  );
}

export function WebPreviewSelectionBar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-blue-500/20 bg-blue-500/10 px-3 py-1.5" data-testid="ai-web-preview-selection">
      {children}
    </div>
  );
}

export function WebPreviewConsole({ value }: { value: string }) {
  return (
    <pre
      className="mx-3 mt-2 h-16 shrink-0 resize-none overflow-auto rounded-md border border-border bg-surface-input p-2 font-mono text-2xs text-muted-foreground"
      data-testid="ai-web-preview-console"
    >
      {value}
    </pre>
  );
}

export function WebPreviewBrowser({
  previewUrl,
  running,
  onReload,
  onOpenExternal,
  agentBrowser,
  onOpenAgentBrowser,
  children,
}: {
  previewUrl?: string | null;
  running?: boolean;
  onReload?: () => void;
  onOpenExternal?: () => void;
  agentBrowser?: {
    active?: boolean;
    busy?: boolean;
    canOpen?: boolean;
    label?: string | null;
    url?: string | null;
  };
  onOpenAgentBrowser?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const agentBrowserTitle = agentBrowser?.active
    ? t('workspace.web.actions.locateAgentBrowser', 'Locate Agent Browser')
    : t('workspace.web.actions.openAgentBrowser', 'Open in Agent Browser');

  return (
    <div className="min-h-0 flex-1 bg-surface-input p-2" data-testid="ai-web-preview-browser">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-white shadow-sm dark:bg-black">
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-surface-modal px-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            disabled={!previewUrl}
            onClick={onReload}
            title={t('workspace.web.actions.refresh', 'Refresh')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border bg-surface-input px-2.5 py-1">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', running ? 'bg-green-500' : 'bg-muted-foreground/30')} />
            <span className="truncate font-mono text-2xs text-muted-foreground">
              {previewUrl ?? t('workspace.web.browser.placeholder', 'Start a preview to load a URL')}
            </span>
            {agentBrowser?.active ? (
              <span
                className="hidden max-w-[34%] shrink-0 truncate rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/10 sm:inline"
                data-testid="ai-web-preview-agent-browser-status"
                title={agentBrowser.url ?? agentBrowser.label ?? undefined}
              >
                {t('workspace.web.browser.agentBrowserActive', 'Agent')}
              </span>
            ) : null}
          </div>
          {onOpenAgentBrowser ? (
            <Button
              variant={agentBrowser?.active ? 'outline' : 'ghost'}
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              disabled={agentBrowser?.busy || !agentBrowser?.canOpen}
              onClick={onOpenAgentBrowser}
              aria-label={agentBrowserTitle}
              title={agentBrowserTitle}
              data-testid="ai-web-preview-agent-browser-open"
            >
              {agentBrowser?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorUp className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          {previewUrl ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={onOpenExternal}
              title={t('workspace.web.actions.openExternal', 'Open externally')}
            >
              <Globe className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function WebPreviewEmpty({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/50" data-testid="ai-web-preview-empty">
      <Globe className="h-7 w-7 opacity-60" />
      <p className="text-xs">{label}</p>
    </div>
  );
}
