import type { ReactNode } from 'react';

export function KnowledgeLibrary({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)]" data-testid="knowledge-library">
      {children}
    </div>
  );
}
