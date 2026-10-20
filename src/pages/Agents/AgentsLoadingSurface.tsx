import type { ReactNode } from 'react';
import { MeasuredLoadingList } from '@/components/loading/MeasuredLoadingList';
import { AgentsStructureSkeleton } from './AgentCard';

export function AgentsLoadingSurface({ loading, label, rows, className }: { loading: boolean; label: string; rows: ReactNode[]; className?: string }) {
  return (
    <MeasuredLoadingList
      surfaceId="agents"
      loading={loading}
      label={label}
      rows={rows}
      className={className}
      skeletonRows={[0, 1, 2].map((index) => <AgentsStructureSkeleton key={index} index={index} />)}
    />
  );
}
