import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentInteractionRenderer,
  parseToolUiContent,
  parseToolUiToolUses,
} from '@/components/tool-ui/agent-interactions';
import { RunMutationDiffs } from '@/components/tool-ui/RunMutationDiffs';
import { RunTerminalSurfaces } from '@/components/tool-ui/RunTerminalSurfaces';
import { Terminal } from '@/components/tool-ui/terminal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => typeof fallback === 'string' ? fallback : key,
  }),
}));

describe('official Tool UI execution payloads', () => {
  it('follows the latest output without pulling a reader away from earlier lines', () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const { rerender } = render(<Terminal id="follow-output" command="pnpm test" stdout={output} maxCollapsedLines={10} truncated />);
    const region = screen.getByRole('region', { name: 'toolUi.terminal.output' });
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    rerender(<Terminal id="follow-output" command="pnpm test" stdout={`${output}\nnext`} maxCollapsedLines={10} truncated />);
    expect(region.scrollTop).toBe(1000);
    region.scrollTop = 20;
    fireEvent.scroll(region);
    rerender(<Terminal id="follow-output" command="pnpm test" stdout={`${output}\nnext\nlast`} maxCollapsedLines={10} truncated />);
    expect(region.scrollTop).toBe(20);
    region.scrollTop = 800;
    fireEvent.scroll(region);
    rerender(<Terminal id="follow-output" command="pnpm test" stdout={`${output}\nnext\nlast\nfinished`} maxCollapsedLines={10} truncated />);
    expect(region.scrollTop).toBe(1000);
    expect(screen.getByText('toolUi.terminal.truncated')).toBeVisible();
    expect(region).not.toContainElement(screen.getByText('toolUi.terminal.truncated'));
    const toggle = screen.getByRole('button', { name: 'toolUi.terminal.showAll' });
    expect(toggle).toHaveAttribute('aria-controls', region.id);
  });

  it('keeps a short CRLF output unfurled and an empty output copy-disabled', () => {
    const { rerender } = render(<Terminal id="short-output" command="pnpm test" stdout={'ok\r\n\r\n'} maxCollapsedLines={1} />);
    expect(screen.queryByRole('button', { name: 'toolUi.terminal.showAll' })).not.toBeInTheDocument();
    rerender(<Terminal id="short-output" command="pnpm test" />);
    expect(screen.getByRole('button', { name: 'toolUi.terminal.noOutputToCopy' })).toBeDisabled();
  });

  it('preserves code indentation and terminal line endings in structured content', () => {
    const original = '    return before;\n';
    const modified = '        return after;\n\n';
    const output = '  build started\n\n  build completed\n';
    const parsed = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({ type: 'code-diff', id: 'indented-diff', original, modified, filePath: 'src/example.ts' }),
      '```',
      '```tool-ui',
      JSON.stringify({ type: 'terminal', id: 'indented-output', command: 'pnpm build', stdout: output }),
      '```',
    ].join('\n'));
    expect(parsed.interactions[0]).toMatchObject({ oldCode: original, newCode: modified });
    expect(parsed.interactions[1]).toMatchObject({ stdout: output });
  });

  it('folds long run output and diffs while copying their complete contents', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const output = Array.from({ length: 30 }, (_, i) => `PASS case ${i + 1}`).join('\n');
    const patch = ['--- src/demo.ts', '+++ src/demo.ts', '@@ -0,0 +1,30 @@',
      ...Array.from({ length: 30 }, (_, i) => `+const value${i + 1} = ${i + 1};`)].join('\n');
    render(<>
      <RunTerminalSurfaces surfaces={[{
        type: 'terminal', id: 'long-command', command: 'pnpm test', output,
        status: 'completed', exitCode: 0, truncated: false,
      }]} />
      <RunMutationDiffs surfaces={[{
        type: 'code-diff', id: 'long-diff', filePath: 'src/demo.ts', language: 'typescript',
        patch, mode: 'full', confidence: 'trusted',
      }]} />
    </>);

    for (const [expand, collapse] of [
      ['toolUi.terminal.showAll', 'toolUi.terminal.collapse'],
      ['toolUi.codeDiff.showFull', 'toolUi.codeDiff.collapse'],
    ]) {
      expect(screen.getByRole('button', { name: expand })).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(screen.getByRole('button', { name: expand }));
      expect(screen.getByRole('button', { name: collapse })).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(screen.getByRole('button', { name: collapse }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'toolUi.terminal.copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(output));
    fireEvent.click(screen.getByRole('button', { name: 'toolUi.codeDiff.copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(patch));
  });

  it('renders a journal-backed mutation patch and copies the same text fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const patch = [
      '--- src/demo.ts',
      '+++ src/demo.ts',
      '@@ -1 +1 @@',
      '-const value = 1;',
      '+const value = 2;',
    ].join('\n');

    render(<RunMutationDiffs surfaces={[{
      type: 'code-diff',
      id: 'call-1:write-journal:session:1:src/demo.ts',
      filePath: 'src/demo.ts',
      language: 'typescript',
      patch,
      mode: 'full',
      confidence: 'trusted',
    }]} />);

    expect(screen.getByTestId('chat-mutation-code-diff')).toHaveTextContent('demo.ts');
    expect(screen.getByTestId('chat-mutation-code-diff')).toHaveTextContent('+1 -1');
    fireEvent.click(screen.getByRole('button', { name: 'toolUi.codeDiff.copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(patch));
  });

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
