/**
 * RunTerminalSurfaces — renders each `command.output` event as an ordered,
 * expandable execution row with the shared terminal for its full output.
 */
import { Terminal as TerminalIcon } from 'lucide-react';
import { Collapsible } from '@/components/ui/collapsible';
import { CallChip } from '@/components/tool-ui/shared/call-chip';
import { Terminal } from '@/components/tool-ui/terminal';
import type { RunTerminalSurface } from '@/components/tool-ui/run-surfaces';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ToolActivityKind } from '@/pages/Chat/tool-activity-groups';

function formatDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function RunTerminalSurfaces({ surfaces, appearance = 'chip', renderToolIcon, currentToolId, activityActive = false }: {
  surfaces: RunTerminalSurface[];
  appearance?: 'chip' | 'activity';
  renderToolIcon?: (kind: ToolActivityKind, reveal: boolean) => ReactNode;
  currentToolId?: string;
  activityActive?: boolean;
}) {
  const { t } = useTranslation('chat');
  if (surfaces.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="chat-run-terminals">
      {surfaces.map((surface) => {
        const animate = appearance === 'activity' && activityActive && surface.status === 'running'
          && (surface.toolCallId ?? surface.id) === currentToolId;
        const running = activityActive && surface.status === 'running';
        const action = surface.status === 'running' && !activityActive ? t('toolActivity.pendingResult')
          : t(`toolActivity.${running ? 'running' : 'completed'}.command`);
        const output = (
          <Terminal
            transcriptDetail
            id={surface.id}
            command={surface.command}
            cwd={surface.cwd}
            stdout={surface.output}
            status={surface.status}
            // The projection merges stdout/stderr into one stream, and the card
            // signals failure through exitCode. A still-running command has no
            // exit code yet, so leave it undefined rather than faking a 0.
            exitCode={surface.status === 'running' ? undefined : surface.exitCode ?? (surface.status === 'failed' ? 1 : 0)}
            durationMs={surface.durationMs}
            truncated={surface.truncated}
            maxCollapsedLines={10}
          />
        );
        return (
          <div key={surface.id} data-testid="chat-run-terminal" data-status={surface.status}>
            <Collapsible
              variant="plain"
              defaultOpen={appearance === 'activity' ? false : surface.status !== 'completed'}
              className={appearance === 'activity' ? 'tool-activity-terminal' : undefined}
              headerClassName={appearance === 'activity' ? 'tool-activity-step-toggle tool-activity-strip-toggle' : undefined}
              title={appearance === 'activity'
                ? <CallChip name={action} argument={surface.command} className="tool-activity-call-chip"
                    status={surface.status === 'failed' ? 'error' : running ? 'running' : surface.status === 'completed' ? 'done' : 'idle'}
                    icon={renderToolIcon?.('command', animate) ?? 'terminal'}
                    startedAt={surface.startedAt} durationMs={surface.durationMs}
                    statusLabel={surface.status === 'running' && !activityActive ? t('toolActivity.pendingResult') : t(`processPanel.status.${surface.status}`)}>
                    {animate ? <Shimmer className="tool-activity-shimmer">{action}</Shimmer> : undefined}
                  </CallChip>
                : surface.status === 'running' || surface.status === 'failed'
              ? <CallChip name={surface.command} icon="terminal" status={surface.status === 'running' ? 'running' : 'error'} statusLabel={t(`processPanel.status.${surface.status}`)} showTimer={false} />
                : <code className="block min-w-0 truncate font-mono text-xs" title={surface.command}>{surface.command}</code>}
              leading={appearance === 'activity' ? undefined
                : surface.status === 'completed' ? <TerminalIcon className="size-3.5" /> : undefined}
              trailing={appearance === 'activity' ? undefined : (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {t(`processPanel.status.${surface.status}`)}{formatDuration(surface.durationMs) ? ` · ${formatDuration(surface.durationMs)}` : ''}
                </span>
              )}
              buttonTestId="chat-run-terminal-toggle"
            >
              {output}
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}
