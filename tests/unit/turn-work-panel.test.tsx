import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TurnWorkPanel } from '@/components/assistant-render/TurnWorkPanel';
import type { TurnWorkModel } from '@/components/assistant-render/turn-work-model';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'turnWork.title') return 'Work panel';
      if (key === 'turnWork.status.running') return 'Working now';
      if (key === 'turnWork.tabs.tasks') return 'Tasks';
      if (key === 'turnWork.tabs.reports') return 'Reports';
      if (key === 'turnWork.tabs.sources') return 'Sources';
      if (key === 'toolUi.plan.progress') {
        return `${String(params?.completed ?? '')} of ${String(params?.total ?? '')} complete`;
      }
      return key;
    },
  }),
}));

describe('TurnWorkPanel', () => {
  it('renders task progress with the Tool UI plan view', () => {
    const model: TurnWorkModel = {
      id: 'run-1',
      status: 'running',
      primaryKind: 'tasks',
      tasks: [
        { id: 'read', label: 'Read source files', status: 'completed', kind: 'tool' },
        { id: 'patch', label: 'Patch focused UI', status: 'running', kind: 'tool', detail: 'Use the shared plan renderer.' },
      ],
      reports: [],
      sources: [],
    };

    render(<TurnWorkPanel model={model} onOpenReport={vi.fn()} />);

    expect(screen.getByTestId('turn-work-panel')).toHaveTextContent('Work panel');
    expect(screen.getByTestId('turn-work-counts-line')).toHaveTextContent('Tasks 2');
    expect(screen.getByTestId('turn-work-plan')).toHaveTextContent('1 of 2 complete');
    expect(screen.getByTestId('turn-work-plan')).toHaveTextContent('Read source files');
    expect(screen.getByTestId('turn-work-plan')).toHaveTextContent('Patch focused UI');
  });
});
