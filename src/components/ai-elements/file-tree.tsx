import type { ReactNode } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AiFileTreeNode = {
  id?: string;
  name: string;
  relPath: string;
  isDir: boolean;
  isFresh?: boolean;
  children?: AiFileTreeNode[];
};

export type FileTreeProps<TNode extends AiFileTreeNode> = {
  nodes: TNode[];
  expanded: Set<string>;
  selectedRel: string | null;
  depth?: number;
  onToggle: (relPath: string) => void;
  onSelect: (relPath: string) => void;
  renderIcon?: (node: TNode) => ReactNode;
  freshLabel?: string;
};

export function FileTree<TNode extends AiFileTreeNode>({
  nodes,
  expanded,
  selectedRel,
  depth = 0,
  onToggle,
  onSelect,
  renderIcon,
  freshLabel,
}: FileTreeProps<TNode>) {
  return (
    <ul className="space-y-0.5" data-testid={depth === 0 ? 'ai-file-tree' : undefined}>
      {nodes.map((node) => (
        <FileTreeRow
          key={node.relPath || node.name}
          node={node}
          depth={depth}
          expanded={expanded}
          selectedRel={selectedRel}
          onToggle={onToggle}
          onSelect={onSelect}
          renderIcon={renderIcon}
          freshLabel={freshLabel}
        />
      ))}
    </ul>
  );
}

function FileTreeRow<TNode extends AiFileTreeNode>({
  node,
  depth,
  expanded,
  selectedRel,
  onToggle,
  onSelect,
  renderIcon,
  freshLabel,
}: Omit<FileTreeProps<TNode>, 'nodes' | 'depth'> & { node: TNode; depth: number }) {
  const isOpen = node.isDir && expanded.has(node.relPath);
  const isSelected = selectedRel === node.relPath;
  const indent = 12 + depth * 14;

  if (node.isDir) {
    return (
      <li data-testid="ai-file-tree-folder">
        <button
          type="button"
          onClick={() => onToggle(node.relPath)}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          style={{ paddingLeft: indent }}
          title={node.relPath || node.name}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{node.name}</span>
        </button>
        {isOpen && node.children?.length ? (
          <FileTree
            nodes={node.children as TNode[]}
            depth={depth + 1}
            expanded={expanded}
            selectedRel={selectedRel}
            onToggle={onToggle}
            onSelect={onSelect}
            renderIcon={renderIcon}
            freshLabel={freshLabel}
          />
        ) : null}
      </li>
    );
  }

  return (
    <li data-testid="ai-file-tree-file">
      <button
        type="button"
        onClick={() => onSelect(node.relPath)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
          isSelected ? 'bg-black/5 text-foreground dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10',
        )}
        style={{ paddingLeft: indent + 16 }}
        title={node.relPath || node.name}
      >
        {renderIcon ? renderIcon(node) : <span className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.isFresh ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs text-blue-700 dark:text-blue-400" title={freshLabel}>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />
            <span className="sr-only">{freshLabel}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}
