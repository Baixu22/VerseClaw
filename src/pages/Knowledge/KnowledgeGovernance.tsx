import type { ReactNode } from 'react';

export function KnowledgeGovernance({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4" data-testid="knowledge-governance">
      {children}
    </div>
  );
}
