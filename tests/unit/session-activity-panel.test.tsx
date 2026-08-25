import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionActivityPanel } from '@/pages/Chat/SessionActivityPanel';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';

const translations: Record<string, string> = {
  'sessionActivity.title': 'Session activity',
  'sessionActivity.sections.goals': 'Goals & waits',
  'sessionActivity.sections.processes': 'Processes',
  'sessionActivity.sections.lineage': 'Lineage',
  'sessionActivity.goalStatus.running': 'Running',
  'sessionActivity.goalStatus.waiting': 'Waiting',
  'sessionActivity.processStatus.running': 'Running',
  'sessionActivity.processStatus.completed': 'Done',
  'sessionActivity.lineageStatus.started': 'Running',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sessionActivity.duration' && options?.count !== undefined) return String(options.count);
      return translations[key] ?? key;
    },
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function projectedSnapshot() {
  const snapshot = createEmptySessionActivitySnapshot('agent:main:main');
  snapshot.goals = [
    {
      id: 'mission-phase5-unit',
      kind: 'mission',
      label: 'Mission mission-phase5-unit',
      status: 'running',
      phase: 'execute',
      progress: 0.4,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'flow-phase5-unit',
      kind: 'flow',
      label: 'Goal wait flow-phase5-unit',
      status: 'waiting',
      digest: 'sha256:unitdigest000000000000000000000000000000000',
      updatedAt: Date.now() - 2_000,
    },
  ];
  snapshot.processes = [
    {
      id: 'bash-phase5-unit',
      kind: 'bash',
      label: 'Process bash-phase5-unit',
      status: 'running',
      pid: 4242,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'goal-owned-phase5-unit',
      kind: 'goalOwned',
      label: 'Goal process goal-owned-phase5-unit',
      status: 'completed',
      digest: 'unitdigest00000000',
      updatedAt: Date.now() - 4_000,
    },
  ];
  snapshot.lineage = [
    {
      id: 'child-phase5-unit',
      kind: 'child',
      sessionKey: 'agent:explorer:child-phase5-unit',
      role: 'explorer',
      status: 'started',
      updatedAt: Date.now() - 500,
    },
  ];
  return snapshot;
}

describe('SessionActivityPanel', () => {
  it('renders goal, process, and lineage states from the read-only snapshot', () => {
    render(<SessionActivityPanel snapshot={projectedSnapshot()} />);

    const goals = screen.getByTestId('session-activity-goals');
    const processes = screen.getByTestId('session-activity-processes');
    const lineage = screen.getByTestId('session-activity-lineage');

    expect(within(goals).getByText('Goals & waits')).toBeInTheDocument();
    expect(within(goals).getByText('sessionActivity.goalKinds.mission Mission mission-phase5-unit')).toBeInTheDocument();
    expect(within(goals).getAllByText('Running').length).toBeGreaterThan(0);
    expect(within(goals).getByText('sessionActivity.goalKinds.flow Goal wait flow-phase5-unit')).toBeInTheDocument();
    expect(within(goals).getByText('Waiting')).toBeInTheDocument();

    expect(within(processes).getByText('Processes')).toBeInTheDocument();
    expect(within(processes).getByText('sessionActivity.processKinds.bash Process bash-phase5-unit')).toBeInTheDocument();
    expect(within(processes).getByText('sessionActivity.processKinds.goalOwned Goal process goal-owned-phase5-unit')).toBeInTheDocument();
    expect(within(processes).getByText('Done')).toBeInTheDocument();

    expect(within(lineage).getByText('Lineage')).toBeInTheDocument();
    expect(within(lineage).getByText('explorer')).toBeInTheDocument();
    expect(within(lineage).getByText('Running')).toBeInTheDocument();
  });

  it('exposes no lifecycle buttons or actions in the projection sections', () => {
    render(<SessionActivityPanel snapshot={projectedSnapshot()} />);

    expect(within(screen.getByTestId('session-activity-goals')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('session-activity-processes')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('session-activity-lineage')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('returns nothing for an empty snapshot', () => {
    const { container } = render(
      <SessionActivityPanel snapshot={createEmptySessionActivitySnapshot('agent:main:empty')} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
