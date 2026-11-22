import { GitCompareArrows } from 'lucide-react';
import { FileLineStatsLabel } from '@/components/tool-ui/shared/file-line-stats';
import { Collapsible } from '@/components/ui/collapsible';
import { CodeDiff } from '@/components/tool-ui/code-diff';
import type { RunCodeDiffSurface } from '@/components/tool-ui/run-surfaces';

export function RunMutationDiffs({ surfaces }: { surfaces: RunCodeDiffSurface[] }) {
  if (surfaces.length === 0) return null;

  return (
    <div className="w-full min-w-0" data-testid="chat-mutation-diffs">
      {surfaces.map((surface) => (
        <Collapsible
          key={surface.id}
          variant="plain"
          title={<span className="font-mono" title={surface.filePath}>{surface.filePath}</span>}
          leading={<GitCompareArrows className="size-3.5" aria-hidden="true" />}
          trailing={surface.lineStats && <FileLineStatsLabel stats={surface.lineStats} />}
          data-testid="chat-mutation-code-diff"
          buttonTestId="chat-mutation-file-toggle"
          contentClassName="ml-0 min-w-0 overflow-hidden border-0 pl-0"
        >
          <CodeDiff
            id={surface.id}
            patch={surface.patch}
            oldCode={surface.original}
            newCode={surface.modified}
            language={surface.language}
            filename={surface.filePath}
            lineNumbers="visible"
            diffStyle="unified"
            maxCollapsedLines={10}
            showStats={false}
          />
        </Collapsible>
      ))}
    </div>
  );
}
