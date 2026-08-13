/**
 * RunTerminalSurfaces — renders `command.output` runtime events as Tool UI
 * terminal cards instead of the flat text rows the execution graph used to
 * show. See `src/pages/Chat/run-surface-promotion.ts` for why the graph no
 * longer renders these events.
 */
import { Terminal } from '@/components/tool-ui/terminal';
import type { RunTerminalSurface } from '@/components/tool-ui/run-surfaces';

export function RunTerminalSurfaces({ surfaces }: { surfaces: RunTerminalSurface[] }) {
  if (surfaces.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="chat-run-terminals">
      {surfaces.map((surface) => (
        <div key={surface.id} data-testid="chat-run-terminal" data-status={surface.status}>
          <Terminal
            id={surface.id}
            command={surface.command}
            cwd={surface.cwd}
            stdout={surface.output}
            // The projection merges stdout/stderr into one stream, and the card
            // signals failure through exitCode. A still-running command has no
            // exit code yet, so leave it undefined rather than faking a 0.
            exitCode={surface.status === 'running' ? undefined : surface.exitCode ?? (surface.status === 'failed' ? 1 : 0)}
            durationMs={surface.durationMs}
            truncated={surface.truncated}
          />
        </div>
      ))}
    </div>
  );
}
