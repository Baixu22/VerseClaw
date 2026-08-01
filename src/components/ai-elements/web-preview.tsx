import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Globe, Loader2, MonitorUp, MoreVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw } from '@/components/icons/codex-icons';

export function WebPreviewRoot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)} data-testid="ai-web-preview">
      {children}
    </div>
  );
}

export function WebPreviewToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[39px] shrink-0 items-center border-b border-border/60 bg-material-panel px-2" data-testid="ai-web-preview-toolbar">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
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
    <div className="shrink-0 border-b border-border/60 bg-black/[0.035] px-3 py-1.5 dark:bg-white/[0.055]" data-testid="ai-web-preview-selection">
      {children}
    </div>
  );
}

export function WebPreviewConsole({ value }: { value: string }) {
  return (
    <pre
      className="h-16 shrink-0 resize-none overflow-auto border-b border-border/60 bg-surface-input px-3 py-2 font-mono text-2xs text-muted-foreground"
      data-testid="ai-web-preview-console"
    >
      {value}
    </pre>
  );
}

export function WebPreviewBrowser({
  previewUrl,
  running,
  onBack,
  onForward,
  onReload,
  onOpenExternal,
  agentBrowser,
  onOpenAgentBrowser,
  toolbarActions,
  menuConfiguration,
  children,
}: {
  previewUrl?: string | null;
  running?: boolean;
  onBack?: () => void;
  onForward?: () => void;
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
  toolbarActions?: ReactNode;
  menuConfiguration?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const agentBrowserTitle = agentBrowser?.active
    ? t('workspace.web.actions.locateAgentBrowser', 'Locate Agent Browser')
    : t('workspace.web.actions.openAgentBrowser', 'Open in Agent Browser');
  const address = (() => {
    if (!previewUrl) return t('workspace.web.browser.placeholder', 'Start a preview to load a URL');
    try {
      const parsed = new URL(previewUrl);
      return `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return previewUrl;
    }
  })();
  const navigationButtonClass = 'h-7 w-7 rounded-md text-zinc-600 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100';

  return (
    <div className="min-h-0 flex-1 bg-material-panel" data-testid="ai-web-preview-browser">
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div className="relative flex h-[39px] shrink-0 items-center gap-0.5 border-b border-border/60 bg-surface-input px-1.5 text-foreground">
          <Button
            variant="ghost"
            size="icon"
            className={navigationButtonClass}
            disabled={!previewUrl || !onBack}
            onClick={onBack}
            aria-label={t('workspace.web.actions.back', 'Back')}
            title={t('workspace.web.actions.back', 'Back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={navigationButtonClass}
            disabled={!previewUrl || !onForward}
            onClick={onForward}
            aria-label={t('workspace.web.actions.forward', 'Forward')}
            title={t('workspace.web.actions.forward', 'Forward')}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={navigationButtonClass}
            disabled={!previewUrl}
            onClick={onReload}
            aria-label={t('workspace.web.actions.refresh', 'Refresh')}
            title={t('workspace.web.actions.refresh', 'Refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <div
            className="absolute left-1/2 flex h-7 w-[min(52%,36rem)] min-w-0 -translate-x-1/2 items-center justify-center gap-2 rounded border border-transparent bg-transparent px-3 transition-colors duration-150 hover:border-border hover:bg-background focus-within:border-ring motion-reduce:transition-none max-sm:static max-sm:ml-1 max-sm:w-auto max-sm:flex-1 max-sm:translate-x-0"
            data-testid="ai-web-preview-address"
            title={previewUrl ?? undefined}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', running ? 'bg-emerald-400' : 'bg-zinc-600')} />
            <span className="truncate text-center font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {address}
            </span>
            {agentBrowser?.active ? (
              <span
                className="hidden max-w-[34%] shrink-0 truncate rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300 sm:inline"
                data-testid="ai-web-preview-agent-browser-status"
                title={agentBrowser.url ?? agentBrowser.label ?? undefined}
              >
                {t('workspace.web.browser.agentBrowserActive', 'Agent')}
              </span>
            ) : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {toolbarActions}
            {onOpenAgentBrowser ? (
              <Button
                variant={agentBrowser?.active ? 'outline' : 'ghost'}
                size="icon"
                className={navigationButtonClass}
                disabled={agentBrowser?.busy || !agentBrowser?.canOpen}
                onClick={onOpenAgentBrowser}
                aria-label={agentBrowserTitle}
                title={agentBrowserTitle}
                data-testid="ai-web-preview-agent-browser-open"
              >
                {agentBrowser?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <MonitorUp className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={navigationButtonClass}
                  aria-label={t('workspace.web.browser.menu', 'Browser menu')}
                  title={t('workspace.web.browser.menu', 'Browser menu')}
                  data-testid="ai-web-preview-browser-menu"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-[80] min-w-56 overflow-hidden rounded-lg border border-border bg-surface-modal p-1.5 text-foreground shadow-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
                >
                  {menuConfiguration ? (
                    <>
                      {menuConfiguration}
                      <DropdownMenu.Separator className="my-1 h-px bg-border" />
                    </>
                  ) : null}
                  <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-medium text-zinc-500">
                    {t('workspace.web.browser.pageActions', 'Page actions')}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item
                    disabled={!previewUrl}
                    onSelect={onReload}
                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors data-[disabled]:opacity-40 data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10 motion-reduce:transition-none"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
                    {t('workspace.web.actions.refresh', 'Refresh')}
                  </DropdownMenu.Item>
                  {onOpenAgentBrowser ? (
                    <DropdownMenu.Item
                      disabled={agentBrowser?.busy || !agentBrowser?.canOpen}
                      onSelect={onOpenAgentBrowser}
                      className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors data-[disabled]:opacity-40 data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10 motion-reduce:transition-none"
                    >
                      <MonitorUp className="h-3.5 w-3.5 text-zinc-400" />
                      {agentBrowserTitle}
                    </DropdownMenu.Item>
                  ) : null}
                  {onOpenExternal ? (
                    <>
                      <DropdownMenu.Separator className="my-1 h-px bg-border" />
                      <DropdownMenu.Item
                        disabled={!previewUrl}
                        onSelect={onOpenExternal}
                        className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors data-[disabled]:opacity-40 data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10 motion-reduce:transition-none"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-zinc-400" />
                        {t('workspace.web.actions.openExternal', 'Open externally')}
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
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
