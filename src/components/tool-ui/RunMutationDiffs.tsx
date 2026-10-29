import { CodeDiff } from '@/components/tool-ui/code-diff';
import type { RunCodeDiffSurface } from '@/components/tool-ui/run-surfaces';

export function RunMutationDiffs({ surfaces }: { surfaces: RunCodeDiffSurface[] }) {
  if (surfaces.length === 0) return null;

  return (
    <div className="w-full min-w-0 max-w-full space-y-2" data-testid="chat-mutation-diffs">
      {surfaces.map((surface) => (
        <div key={surface.id} className="w-full min-w-0 max-w-full overflow-hidden" data-testid="chat-mutation-code-diff">
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
          />
        </div>
      ))}
    </div>
  );
}
