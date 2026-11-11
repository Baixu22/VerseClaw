import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';
import { deriveRuntimeTaskSteps, type TaskStep } from '@/pages/Chat/task-visualization';
import type { ChatRuntimeRunState } from '@/stores/chat/types';

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
  it('pairs each tool result with its call while preserving unmatched results', () => {
    const call = { ...branchStep, id: 'read-1', label: 'read_file', status: 'completed' as const, detail: '{"path":"src/app.ts"}' };
    const result: TaskStep = { id: 'tool-result-read-1', label: 'Tool Result: read_file', kind: 'system', status: 'completed', depth: 1, detail: 'Retained result\n' };
    const orphan: TaskStep = { ...result, id: 'tool-result-missing', label: 'Tool Result: missing', detail: 'Unpaired result' };
    render(<ExecutionGraphCard agentLabel="main" steps={[call, result, orphan]} active={false} />);
    expect(screen.getAllByTestId('chat-execution-step')).toHaveLength(2);
    expect(screen.queryByText('Tool Result: read_file')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('chat-execution-step-toggle')[0]);
    const detail = screen.getByRole('region', { name: 'read_file' });
    expect(detail).toHaveTextContent('src/app.ts');
    expect(detail).toHaveTextContent('Retained result');
    expect(screen.getByText('Tool Result: missing')).toBeVisible();
  });

  it('previews the edit target and reveals complete arguments only on expansion', () => {
    const detail = JSON.stringify({
      file_path: '/workspace/src/components/conversation/Message.tsx',
      old_string: 'const before = true;',
      new_string: 'const after = true;',
    });
    render(<ExecutionGraphCard agentLabel="main" steps={[{ ...branchStep, label: 'edit', detail }]} active={false} />);

    expect(screen.getByText('/workspace/src/components/conversation/Message.tsx')).toBeVisible();
    expect(screen.queryByText(/old_string/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-execution-step-toggle'));
    const region = screen.getByRole('region', { name: 'edit' });
    expect(JSON.parse(region.textContent!)).toEqual(JSON.parse(detail));
    expect(screen.getByTestId('chat-execution-step-toggle')).toHaveAttribute('aria-controls', region.id);
    fireEvent.click(screen.getByTestId('chat-execution-step-toggle'));
    expect(screen.queryByRole('region', { name: 'edit' })).not.toBeInTheDocument();
  });

  it('renders completed tool calls as done chips with their measured duration', () => {
    const completedStep: TaskStep = { ...branchStep, status: 'completed', durationMs: 1840 };
    render(<ExecutionGraphCard agentLabel="main" steps={[completedStep]} active={false} />);

    const chip = screen.getByTestId('chat-call-chip');
    expect(chip).toHaveAttribute('data-status', 'done');
    expect(chip).toHaveTextContent('1840 ms');
    expect(chip).toHaveAttribute('aria-label', 'exec, openclaw gateway start, completed');
  });

  it('derives measured duration from runtime tool events', () => {
    const run: ChatRuntimeRunState = {
      runId: 'run-duration',
      status: 'completed',
      assistantText: '',
      thinkingText: '',
      events: [
        { runId: 'run-duration', type: 'tool.started', toolCallId: 'tool-duration', name: 'exec', ts: 1_000 },
        { runId: 'run-duration', type: 'tool.completed', toolCallId: 'tool-duration', name: 'exec', ts: 2_500 },
      ],
    };

    const steps = deriveRuntimeTaskSteps(run);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      status: 'completed',
      startedAt: 1_000,
      durationMs: 1_500,
    });
  });

  it('renders nested branches through geometry without a branch badge', () => {
    render(<ExecutionGraphCard agentLabel="main" steps={[branchStep]} active />);

    const step = screen.getByTestId('chat-execution-step');
    expect(step).toHaveStyle({ marginLeft: '24px' });
    expect(screen.queryByText('分支')).toBeNull();
  });

  it('renders error status as a red call chip with its target intact', () => {
    const erroredToolStep: TaskStep = { ...branchStep, depth: 1, status: 'error' };
    render(<ExecutionGraphCard agentLabel="main" steps={[erroredToolStep]} active={false} />);

    const chip = screen.getByTestId('chat-call-chip');
    expect(chip).toHaveAttribute('data-status', 'error');
    expect(chip).toHaveAttribute('aria-label', 'exec, openclaw gateway start, error');
    expect(screen.getByText('openclaw gateway start')).toHaveAttribute('title', 'openclaw gateway start');
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

  it('supports controlled detail expansion for card-level persistence', () => {
    const onStepExpandedChange = vi.fn();
    const { rerender } = render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expandedStepIds={new Set()}
        onStepExpandedChange={onStepExpandedChange}
      />,
    );

    fireEvent.click(screen.getByText('main subagent'));
    expect(onStepExpandedChange).toHaveBeenCalledWith(subagentStep.id, true);
    expect(screen.queryByTestId('chat-execution-step-detail')).not.toBeInTheDocument();

    rerender(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expandedStepIds={new Set([subagentStep.id])}
        onStepExpandedChange={onStepExpandedChange}
      />,
    );
    expect(screen.getByTestId('chat-execution-step-detail')).toHaveTextContent(subagentStep.detail!);
  });
});
