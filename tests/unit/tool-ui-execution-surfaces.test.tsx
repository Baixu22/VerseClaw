import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentInteractionRenderer,
  parseToolUiContent,
  parseToolUiToolUses,
} from '@/components/tool-ui/agent-interactions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => typeof fallback === 'string' ? fallback : key,
  }),
}));

describe('official Tool UI execution payloads', () => {
  it.each([
    ['approval-card', 'approval-card'],
    ['terminal-output', 'terminal'],
    ['code_diff', 'code-diff'],
    ['run-progress', 'progress-tracker'],
  ])('recognizes %s as %s', (component, expectedType) => {
    const payloads: Record<string, Record<string, unknown>> = {
      'approval-card': {
        type: component,
        id: 'approval-1',
        title: 'Run command?',
        description: 'pnpm test',
      },
      'terminal-output': {
        type: component,
        id: 'terminal-1',
        command: 'pnpm test',
        output: 'PASS',
        status: 'completed',
      },
      code_diff: {
        type: component,
        id: 'diff-1',
        filePath: 'src/demo.ts',
        original: 'const a = 1;',
        modified: 'const a = 2;',
      },
      'run-progress': {
        type: component,
        id: 'progress-1',
        steps: [{ id: 'step-1', label: 'Read files', status: 'completed' }],
        status: 'completed',
      },
    };
    const parsed = parseToolUiContent([
      'Before',
      '```tool-ui',
      JSON.stringify(payloads[component]),
      '```',
      'After',
    ].join('\n'));

    expect(parsed.interactions[0]).toMatchObject({ type: expectedType });
    expect(parsed.displayText).toBe('Before\n\nAfter');
    expect(parsed.displayText).not.toContain(component);
  });

  it('keeps tool-use and wrapper parsing compatible for execution surfaces', () => {
    const interactions = parseToolUiToolUses([
      {
        id: 'terminal-call',
        name: '@tool-ui/terminal',
        input: {
          command: 'pnpm test',
          output: 'PASS',
          status: 'completed',
        },
      },
      {
        id: 'diff-call',
        name: 'tool-ui.code-diff',
        input: {
          filePath: 'src/demo.ts',
          original: 'before',
          modified: 'after',
        },
      },
    ]);

    expect(interactions.map((interaction) => interaction.type)).toEqual(['terminal', 'code-diff']);
  });

  it('renders a model approval card and returns only a chat interaction response', async () => {
    const onSubmitResponse = vi.fn();
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({
        type: 'approval-card',
        id: 'model-approval',
        title: 'Publish draft?',
        description: 'The agent is asking for confirmation.',
        confirmLabel: 'Approve',
        cancelLabel: 'Deny',
      }),
      '```',
    ].join('\n'));

    render(
      <AgentInteractionRenderer
        interactions={parsed.interactions}
        canSubmit
        onSubmitResponse={onSubmitResponse}
      />,
    );

    expect(screen.getByTestId('chat-tool-ui-approval')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });
    expect(onSubmitResponse).toHaveBeenCalledTimes(1);
    expect(onSubmitResponse.mock.calls[0][0]).toContain('"type": "approval-card"');
    expect(onSubmitResponse.mock.calls[0][0]).toContain('"action": "approved"');
  });

  it('renders all execution surfaces from one assistant message', () => {
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({
        type: 'approval-card',
        id: 'approval-1',
        title: 'Publish?',
      }),
      '```',
      '```tool-ui',
      JSON.stringify({
        type: 'terminal',
        id: 'terminal-1',
        command: 'pnpm test',
        stdout: '22 tests passed',
        exitCode: 0,
      }),
      '```',
      '```tool-ui',
      JSON.stringify({
        type: 'code-diff',
        id: 'diff-1',
        filePath: 'src/agent.ts',
        original: 'const state = "pending";',
        modified: 'const state = "completed";',
      }),
      '```',
      '```tool-ui',
      JSON.stringify({
        type: 'progress-tracker',
        id: 'progress-1',
        steps: [{ id: 'verify', label: 'Verify UI', status: 'completed' }],
        status: 'completed',
        choice: {
          outcome: 'success',
          summary: 'Execution surfaces verified',
          at: '2026-07-12T00:00:00.000Z',
        },
      }),
      '```',
    ].join('\n'));

    render(
      <AgentInteractionRenderer
        interactions={parsed.interactions}
        canSubmit
      />,
    );

    expect(parsed.interactions).toHaveLength(4);
    expect(screen.getByTestId('chat-tool-ui-approval')).toBeVisible();
    expect(screen.getByTestId('chat-tool-ui-terminal')).toHaveTextContent('22 tests passed');
    expect(screen.getByTestId('chat-tool-ui-code-diff')).toHaveTextContent('agent.ts');
    expect(screen.getByTestId('chat-tool-ui-progress-tracker')).toHaveTextContent('Execution surfaces verified');
  });
});
