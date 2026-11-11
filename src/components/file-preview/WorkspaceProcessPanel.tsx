/**
 * One shell process's own page: what was run, how it ended, and what it printed.
 *
 * The subject is the launching tool call's id, carried on the tab
 * (`PanelTabInstance.subject`). The process itself is read live from the chat
 * runtime run state via `projectRunProcesses`, so an open page follows a running
 * command's output as it streams rather than showing a snapshot from the moment
 * it was clicked.
 *
 * WHY NOT `SessionActivitySnapshot.processes`. That projection is deliberately
 * redacted — its type says "Never carries raw argv, command, cwd, or env text" —
 * so it can list a process but can never show one. The runtime run state already
 * holds the real command and stdout because the transcript's terminal cards need
 * them, so this page reads from there. No new IPC, and the redaction contract on
 * the snapshot stays intact.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@/components/tool-ui/terminal';
import { projectRunProcesses } from '@/components/tool-ui/run-surfaces';
import { useChatStore } from '@/stores/chat';

export function WorkspaceProcessPanel({ processId }: { processId: string }) {
  const { t } = useTranslation('chat');
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const runtimeRuns = useChatStore((s) => s.runtimeRuns);

  /* Scan this session's runs for the process. Keyed by the launching tool call,
   * which is unique per run, so the first match is the right one. */
  const process = useMemo(() => {
    for (const run of Object.values(runtimeRuns)) {
      if (run.sessionKey && run.sessionKey !== sessionKey) continue;
      const match = projectRunProcesses(run).find((entry) => entry.id === processId);
      if (match) return match;
    }
    return null;
  }, [processId, runtimeRuns, sessionKey]);

  if (!process) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center"
        data-testid="workspace-process-empty"
      >
        <p className="text-xs text-muted-foreground">{t('processPanel.gone')}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 min-w-0 p-3" data-testid="workspace-process-panel">
      <Terminal
        key={process.id}
        id={process.id}
        command={process.command}
        cwd={process.cwd}
        stdout={process.output}
        status={process.status}
        exitCode={process.exitCode}
        durationMs={process.durationMs}
        truncated={process.truncated}
        fill
      />
    </div>
  );
}

export default WorkspaceProcessPanel;
