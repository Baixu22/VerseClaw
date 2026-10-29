import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import MarkdownPreview, { markdownOutline } from '@/components/file-preview/MarkdownPreview';
import { DurationPicker } from '@/components/rareui/DurationPicker';
import { ThemeSelector, type ThemeSelectorOption } from '@/components/rareui/ThemeSelector';
import { DeleteButton } from '@/components/rareui/DeleteButton';
import { buildCompletionActivity } from '@/components/rareui/completion-activity';
import { getInitialCronSchedule, readCronTime, writeCronTime } from '@/pages/Cron';
import type { UserRunCard } from '@/pages/Chat/execution-projection';
import type { CronJob } from '@shared/types/cron';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

describe('Rare UI production adaptations', () => {
  it('builds unique nested Markdown anchors and ignores fenced headings', () => {
    const items = markdownOutline('# Guide\n\n## Repeated\n\n### Details\n\n## Repeated\n\n```md\n# Code only\n```', 'one');
    expect(items.map((item) => [item.label, item.depth])).toEqual([['Guide', 0], ['Repeated', 1], ['Details', 2], ['Repeated', 1]]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    expect(markdownOutline('Setext heading\n===\n\ntext', 'two')[0].label).toBe('Setext heading');
  });

  it('renders matching unique heading IDs for independent preview instances', () => {
    render(<TooltipProvider><MarkdownPreview source={'# A\n## A'} /><MarkdownPreview source={'# A\n## A'} /></TooltipProvider>);
    const ids = screen.getAllByRole('heading').map((heading) => heading.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every(Boolean)).toBe(true);
    fireEvent.click(screen.getAllByTestId('markdown-toc-toggle')[0]);
    expect(screen.getByTestId('markdown-toc-panel').querySelectorAll('nav button')).toHaveLength(2);
  });

  it('keeps a time edit local until confirm and rejects fractional/out-of-range input', () => {
    const confirm = vi.fn();
    render(<DurationPicker value={{ hours: 9, minutes: 15 }} onConfirm={confirm} />);
    fireEvent.click(screen.getByTestId('duration-picker-edit'));
    fireEvent.change(screen.getByTestId('duration-picker-hours'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('duration-picker-edit'));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('duration-picker-hours'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('duration-picker-minutes'), { target: { value: '30' } });
    fireEvent.keyDown(screen.getByTestId('duration-picker-minutes'), { key: 'Escape' });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('duration-picker-hours')).toHaveValue(9);
    fireEvent.click(screen.getByTestId('duration-picker-edit'));
    fireEvent.change(screen.getByTestId('duration-picker-hours'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('duration-picker-minutes'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('duration-picker-edit'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith({ hours: 10, minutes: 30 });
  });

  it('edits only cron hour and minute fields and preserves unsupported schedules', () => {
    expect(readCronTime('15 9 * * 1')).toEqual({ hours: 9, minutes: 15 });
    expect(writeCronTime('15 9 3 * 1', { hours: 10, minutes: 30 })).toBe('30 10 3 * 1');
    expect(readCronTime('*/5 * * * *')).toBeNull();
    expect(readCronTime('60 24 * * *')).toBeNull();
    expect(getInitialCronSchedule({ schedule: { kind: 'every', everyMs: 300_000 } } as CronJob)).toBe('');
    expect(getInitialCronSchedule({ schedule: { kind: 'at', at: '2026-10-22T09:00:00Z' } } as CronJob)).toBe('');
  });

  it('leaves deletion effects and success to the confirmation owner', () => {
    const request = vi.fn();
    render(<DeleteButton aria-label="Request delete" onClick={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request delete' }));
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).not.toHaveAttribute('data-status', 'deleted');
  });

  it('sorts completed and failed runs newest first while excluding active runs', () => {
    const cards = [
      { runKey: 'old', triggerIndex: 0, status: 'completed', active: false, hasVisibleReply: true, endedAt: 100_000 },
      { runKey: 'running', triggerIndex: 2, status: 'running', active: true, hasVisibleReply: false },
      { runKey: 'failed', triggerIndex: 4, status: 'error', active: false, hasVisibleReply: false, endedAt: 210_000 },
    ] as UserRunCard[];
    const entries = buildCompletionActivity('current', cards, {
      newest: { runId: 'newest', sessionKey: 'other', status: 'completed', endedAt: 200_000, assistantText: '', thinkingText: '', events: [] },
      active: { runId: 'active', sessionKey: 'other', status: 'running', assistantText: '', thinkingText: '', events: [] },
    }, new Map([[0, 'Visible response']]), [{ index: 1, response: 'Completed reply', completedAt: 150 }, { index: 2, response: 'Still active', completedAt: 300 }], 2);
    expect(entries.map((entry) => entry.id)).toEqual(['current:failed', 'other:newest', 'current:message:1', 'current:old']);
    expect(entries[0]).toMatchObject({ kind: 'error', preview: '' });
    expect(entries[2]).toMatchObject({ index: 1, completedAt: 150_000, preview: 'Completed reply', kind: 'completed' });
    expect(entries[3].preview).toBe('Visible response');
    expect(buildCompletionActivity('current', [], {}, new Map())).toEqual([]);
  });

  it('theme selector exposes radios, single tab stop, and activation by mouse and keyboard', () => {
    const options: ThemeSelectorOption[] = [
      { value: 'light', label: 'Light', preview: 'light' },
      { value: 'dark', label: 'Dark', preview: 'dark' },
      { value: 'system', label: 'System', preview: 'split' },
    ];
    const onChange = vi.fn();
    render(<ThemeSelector aria-label="Theme" value="light" options={options} onChange={onChange} />);

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Light', 'Dark', 'System']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // Roving tab index: only the checked option is in the tab order.
    expect(radios.map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenLastCalledWith('dark');
    // Controlled: the parent owns the value until it re-renders.
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('theme selector wraps arrow keys and honours Home/End without marking itself checked', () => {
    const options: ThemeSelectorOption[] = [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ];
    const onChange = vi.fn();
    render(<ThemeSelector aria-label="Theme" value="dark" options={options} onChange={onChange} />);
    const radios = screen.getAllByRole('radio');

    fireEvent.keyDown(radios[1], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('system');
    // Wraps past the end.
    fireEvent.keyDown(radios[2], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('light');
    fireEvent.keyDown(radios[0], { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('system');
    fireEvent.keyDown(radios[0], { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('light');
    // Unrelated keys must not select anything.
    onChange.mockClear();
    fireEvent.keyDown(radios[0], { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('theme selector still selects and accepts keyboard input when uncontrolled', () => {
    const options: ThemeSelectorOption[] = [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ];
    render(<ThemeSelector aria-label="Theme" defaultValue="light" options={options} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveAttribute('tabindex', '0');
  });
  it('keeps the desktop notification switch in the attention menu', async () => {
    vi.doMock('react-router-dom', async (importOriginal) => ({
      ...await importOriginal<typeof import('react-router-dom')>(),
      useNavigate: () => () => undefined,
    }));
    const { CompletionActivityMenu } = await import('@/components/rareui/CompletionActivityMenu');
    const { useCompletionActivityStore } = await import('@/components/rareui/completion-activity-store');
    const { useSettingsStore } = await import('@/stores/settings');
    useCompletionActivityStore.setState({
      activities: [],
      nudges: [{ id: 'approval:1', sessionKey: 'agent:main:main', kind: 'action-required', status: 'rm file', occurredAt: 100 }],
      pendingNavigation: null,
    });
    useSettingsStore.setState({ desktopNotificationsEnabled: true });
    render(<TooltipProvider><CompletionActivityMenu /></TooltipProvider>);
    fireEvent.click(screen.getByTestId('chat-completion-bell'));
    const toggle = await screen.findByTestId('chat-completion-desktop-toggle');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().desktopNotificationsEnabled).toBe(false);
    expect(screen.getByTestId('chat-completion-desktop-state')).toHaveTextContent('desktopOff');
  });
});
