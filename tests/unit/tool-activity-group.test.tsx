import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import en from '../../shared/i18n/locales/en/chat.json';
import { ToolActivityGroup } from '@/components/assistant-render/ToolActivityGroup';
import type { ToolActivityGroupModel } from '@/pages/Chat/tool-activity-groups';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string, params?: Record<string, unknown>) => {
  let value: unknown = en;
  for (const part of key.split('.')) value = (value as Record<string, unknown>)?.[part];
  return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(params?.[name] ?? ''));
} }) }));

function model(running = false): ToolActivityGroupModel {
  const entry = { id: 'read', name: 'read_file', kind: 'read' as const, target: '/project/config.ts', running, order: 0 };
  return { id: 'run:read', runKey: 'run', anchorIndex: 1, agentLabel: 'Main', status: running ? 'running' : 'completed',
    steps: [{ id: 'read', kind: 'tool', label: 'read_file', status: running ? 'running' : 'completed', depth: 1,
      inputDetail: '{"path":"/project/config.ts"}', detail: running ? '{"path":"/project/config.ts"}' : 'FULL_READ_RESULT',
      startedAt: Date.now() - 1000, durationMs: running ? undefined : 1350 }],
    terminals: [], files: [], diffs: [], entries: [entry], current: running ? entry : undefined, isCurrent: running };
}
function Harness({ group }: { group: ToolActivityGroupModel }) {
  const [open, setOpen] = useState(false);
  return <ToolActivityGroup group={group} expanded={open} onExpandedChange={setOpen} />;
}
describe('tool activity disclosure', () => {
  it('starts folded and exposes the original arguments and result on demand', () => {
    render(<Harness group={model()} />);
    const toggle = screen.getByTestId('chat-tool-activity-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('FULL_READ_RESULT')).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('chat-execution-step-toggle'));
    expect(screen.getByText('FULL_READ_RESULT')).toBeVisible();
    expect(screen.getByText(/"path":/)).toBeVisible();
  });
  it('moves the live shimmer into the details and preserves manual expansion on completion', () => {
    const view = render(<Harness group={model(true)} />);
    expect(screen.getAllByTestId('ai-element-shimmer')).toHaveLength(1);
    expect(within(screen.getByTestId('chat-tool-activity-toggle')).getByTestId('chat-call-chip')).toHaveTextContent('/project/config.ts');
    fireEvent.click(screen.getByTestId('chat-tool-activity-toggle'));
    expect(within(screen.getByTestId('chat-tool-activity-toggle')).queryByTestId('ai-element-shimmer')).toBeNull();
    expect(screen.getAllByTestId('ai-element-shimmer')).toHaveLength(1);
    view.rerender(<Harness group={model()} />);
    expect(screen.getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('ai-element-shimmer')).toBeNull();
  });
  it('restores the running progress strip and settles it using the call status', async () => {
    const view = render(<Harness group={model(true)} />);
    const header = within(screen.getByTestId('chat-tool-activity-toggle'));
    expect(header.getByTestId('chat-call-chip')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(header.getByTestId('chat-call-chip-progress')).not.toHaveStyle({ transform: 'scaleX(0)' }));
    view.rerender(<Harness group={model()} />);
    expect(header.getByTestId('chat-call-chip')).toHaveAttribute('data-status', 'done');
    expect(header.getByTestId('chat-call-chip')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByTestId('ai-element-shimmer')).toBeNull();
  });
  it('keeps a failed group static while exposing its attention state', () => {
    render(<Harness group={{ ...model(true), status: 'error' }} />);
    expect(screen.getByTestId('chat-tool-activity-label')).toHaveTextContent('Needs attention');
    expect(screen.queryByTestId('ai-element-shimmer')).toBeNull();
    expect(screen.getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId('chat-tool-activity-toggle'));
    const detailChip = within(screen.getByTestId('chat-tool-activity-details')).getByTestId('chat-call-chip');
    expect(detailChip).toHaveAttribute('data-status', 'idle');
    expect(detailChip).not.toHaveAttribute('aria-busy');
    expect(detailChip.getAttribute('aria-label')).not.toContain(en.taskPanel.stepStatus.running);
  });
  it('keeps a background call running while the white highlight follows the newest group', () => {
    render(<Harness group={{ ...model(true), isCurrent: false }} />);
    expect(screen.getByTestId('chat-call-chip')).toHaveAttribute('data-status', 'running');
    expect(screen.queryByTestId('ai-element-shimmer')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-tool-activity-toggle'));
    expect(within(screen.getByTestId('chat-tool-activity-details')).getByTestId('chat-call-chip')).toHaveAttribute('data-status', 'running');
    expect(screen.queryByTestId('ai-element-shimmer')).toBeNull();
  });
});
