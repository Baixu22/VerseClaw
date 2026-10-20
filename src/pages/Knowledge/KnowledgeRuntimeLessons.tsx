import type { ReactNode } from 'react';

export function KnowledgeRuntimeLessons({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5" data-testid="knowledge-runtime-lessons">
      {children}
    </div>
  );
}
