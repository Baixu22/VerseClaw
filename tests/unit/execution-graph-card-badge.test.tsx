import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';
import type { TaskStep } from '@/pages/Chat/task-visualization';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'executionGraph.agentRun') return `${String(params?.agent ?? '')} execution`;
      if (key === 'executionGraph.thinkingLabel') return 'Thinking';
      if (key.startsWith('taskPanel.stepStatus.')) return key.split('.').at(-1) ?? key;
      return key;
    },
  }),
}));

const branchStep: TaskStep = {
  id: 'sub-exec-1',
  label: 'exec',
  kind: 'tool',
  status: 'running',
  depth: 2,
  parentId: 'sub-root',
  detail: '{ "command": "openclaw gateway start", "yieldMs": 10000, "timeout": 60 }',
};

const subagentStep: TaskStep = {
  id: 'subagent:08efe821',
  label: 'main subagent',
  kind: 'system',
  status: 'completed',
  detail: 'agent:main:subagent:08efe821-2717-4395-b3d7-a8f50928155f',
  depth: 1,
  parentId: 'agent-run',
};

describe('ExecutionGraphCard flat activity rows', () => {
  it('renders nested branches through geometry without a branch badge', () => {
    render(<ExecutionGraphCard agentLabel="main" steps={[branchStep]} active />);

    const step = screen.getByTestId('chat-execution-step');
    expect(step).toHaveStyle({ marginLeft: '32px' });
    expect(screen.queryByText('分支')).toBeNull();
  });

  it('renders error status as wrap-safe text rather than a pill', () => {
    const erroredToolStep: TaskStep = { ...branchStep, depth: 1, status: 'error' };
    render(<ExecutionGraphCard agentLabel="main" steps={[erroredToolStep]} active={false} />);

    const status = screen.getByText('error');
    expect(status.className).toContain('whitespace-nowrap');
    expect(status.className).not.toContain('rounded-full');
  });

  it('uses a text-first system row without card chrome', () => {
    const { container } = render(
      <ExecutionGraphCard agentLabel="main" steps={[subagentStep]} active={false} />,
    );

    const stepRow = container.querySelector('[data-testid="chat-execution-step"]');
    expect(stepRow).not.toBeNull();
    expect(stepRow!.querySelector('.shadow-sm')).toBeNull();
    expect(stepRow!.querySelector('.bg-background\\/60')).toBeNull();
  });

  it('renders the session key as a truncated inline preview and omits completed status', () => {
    render(<ExecutionGraphCard agentLabel="main" steps={[subagentStep]} active={false} />);

    const preview = screen.getByText(subagentStep.detail!);
    expect(preview.className).toContain('truncate');
    expect(screen.getByText('main subagent').className).toContain('font-medium');
    expect(screen.queryByText('completed')).toBeNull();
  });

  it('expands details beneath a hairline when clicked', () => {
    const { container } = render(
      <ExecutionGraphCard agentLabel="main" steps={[subagentStep]} active={false} />,
    );

    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByText('main subagent'));
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(subagentStep.detail);
    expect(pre!.parentElement?.className).toContain('border-l');
  });
});
