import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import MarkdownPreview, { markdownOutline } from '@/components/file-preview/MarkdownPreview';
import { DurationPicker } from '@/components/rareui/DurationPicker';
import { ThemeSelector, type ThemeSelectorOption } from '@/components/rareui/ThemeSelector';
import { DeleteButton } from '@/components/rareui/DeleteButton';
import { NotificationBell } from '@/components/rareui/NotificationBell';
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

  it('groups only consecutive entries of one session, keeping the feed newest-first', async () => {
    const { groupConsecutiveBySession } = await import('@/components/rareui/completion-activity');
    const entry = (id: string, sessionKey: string) => ({ id, sessionKey, kind: 'completed' as const, status: '', occurredAt: 1 });
    const groups = groupConsecutiveBySession([entry('a', 'one'), entry('b', 'one'), entry('c', 'two'), entry('d', 'one')]);
    expect(groups.map((group) => [group.sessionKey, group.entries.map((item) => item.id)])).toEqual([
      ['one', ['a', 'b']],
      ['two', ['c']],
      ['one', ['d']],
    ]);
  });

  it('formats a running clock with tabular minutes and seconds', async () => {
    const { formatElapsed } = await import('@/components/rareui/completion-activity');
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(42_400)).toBe('0:42');
    expect(formatElapsed(12 * 60_000 + 5_000)).toBe('12:05');
    expect(formatElapsed(3_729_000)).toBe('1:02:09');
    expect(formatElapsed(-5_000)).toBe('0:00');
  });

  it('shows live sessions, marks waiting sessions, and colours unread activity by severity', async () => {
    vi.doMock('react-router-dom', async (importOriginal) => ({
      ...await importOriginal<typeof import('react-router-dom')>(),
      useNavigate: () => () => undefined,
    }));
    const { CompletionActivityMenu } = await import('@/components/rareui/CompletionActivityMenu');
    const { useCompletionActivityStore } = await import('@/components/rareui/completion-activity-store');
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ sessionLabels: { 'agent:main:a': 'Release notes', 'agent:main:b': 'Audit pass' } } as never);
    useCompletionActivityStore.setState({
      activities: [],
      nudges: [
        { id: 'run:3:error', sessionKey: 'agent:main:b', kind: 'error', status: 'Tool crashed', occurredAt: 300 },
        { id: 'run:2:completed', sessionKey: 'agent:main:a', kind: 'completed', status: 'completed', occurredAt: 200 },
        { id: 'run:1:completed', sessionKey: 'agent:main:a', kind: 'completed', status: 'Drafted the changelog', occurredAt: 100 },
      ],
      pendingNavigation: null,
    });
    const live = [
      { sessionKey: 'agent:main:a', label: 'Release notes', state: 'running' as const, startedAt: Date.now() - 65_000 },
    ];
    const view = render(<TooltipProvider><CompletionActivityMenu liveSessions={live} /></TooltipProvider>);
    const bell = screen.getByTestId('chat-completion-bell');
    expect(bell).toHaveAttribute('data-live', 'running');
    expect(screen.getByTestId('chat-activity-bell-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-live-ring')).toBeNull();
    // Three unread, one of them an error: the badge says so in number and colour.
    expect(bell).toHaveAttribute('data-tone', 'error');
    expect(screen.getByTestId('chat-completion-unread-dot')).toHaveTextContent('3');
    expect(bell).toHaveAttribute('aria-label', 'completionActivity.labelLive');

    fireEvent.click(bell);
    const liveItems = screen.getAllByTestId('chat-activity-live-item');
    expect(liveItems).toHaveLength(1);
    expect(liveItems[0]).toHaveTextContent('Release notes');
    expect(liveItems[0]).toHaveTextContent(/1:0\d/);
    // Every finished turn stays its own item, newest first; the session name is
    // said once per consecutive run of entries instead of on every item.
    const items = screen.getAllByTestId('chat-completion-item');
    expect(items.map((item) => item.getAttribute('data-kind'))).toEqual(['error', 'completed', 'completed']);
    expect(document.querySelectorAll('.rare-activity-group__head')).toHaveLength(2);
    // Machine words never leak into the preview line.
    expect(items[1]).not.toHaveTextContent(/^completed/);
    expect(items[1]).toHaveTextContent('completionActivity.kind.completed');
    // Opening the panel reads the entries; they stay marked as fresh while it is open.
    await waitFor(() => expect(screen.queryByTestId('chat-completion-unread-dot')).toBeNull());
    expect(items.every((item) => item.getAttribute('data-fresh') === 'true')).toBe(true);

    view.rerender(<TooltipProvider><CompletionActivityMenu liveSessions={[{ ...live[0], state: 'waiting' }]} /></TooltipProvider>);
    expect(screen.getByTestId('chat-completion-bell')).toHaveAttribute('data-live', 'waiting');
    expect(screen.getByTestId('chat-activity-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('chat-activity-live-item')).toHaveAttribute('data-state', 'waiting');
  });

  it('uses one corner indicator for waiting and unread activity', async () => {
    const view = render(<NotificationBell count={12} live="waiting" tone="error" aria-label="Activity" />);
    expect(screen.getByTestId('chat-completion-unread-dot')).toHaveTextContent('9+');
    expect(screen.queryByTestId('chat-activity-waiting')).toBeNull();
    view.rerender(<NotificationBell count={0} live="waiting" aria-label="Activity" />);
    await waitFor(() => expect(screen.queryByTestId('chat-completion-unread-dot')).toBeNull());
    expect(screen.getByTestId('chat-activity-waiting')).toBeInTheDocument();
    view.rerender(<NotificationBell count={0} live="idle" aria-label="Activity" />);
    expect(screen.queryByTestId('chat-activity-waiting')).toBeNull();
  });

  it('shows an honest empty state when nothing ran and nothing is running', async () => {
    vi.doMock('react-router-dom', async (importOriginal) => ({
      ...await importOriginal<typeof import('react-router-dom')>(),
      useNavigate: () => () => undefined,
    }));
    const { CompletionActivityMenu } = await import('@/components/rareui/CompletionActivityMenu');
    const { useCompletionActivityStore } = await import('@/components/rareui/completion-activity-store');
    useCompletionActivityStore.setState({ activities: [], nudges: [], pendingNavigation: null });
    render(<TooltipProvider><CompletionActivityMenu /></TooltipProvider>);
    const bell = screen.getByTestId('chat-completion-bell');
    expect(bell).toHaveAttribute('data-live', 'idle');
    expect(screen.queryByTestId('chat-activity-live-ring')).toBeNull();
    fireEvent.click(bell);
    expect(screen.getByTestId('chat-activity-empty')).toHaveTextContent('completionActivity.emptyTitle');
    expect(screen.queryByTestId('chat-activity-live')).toBeNull();
  });

  it('plans a title marquee only for titles that overflow, at a constant speed', async () => {
    const { planTitleMarquee, TITLE_MARQUEE_GAP_PX, TITLE_MARQUEE_SPEED_PX_PER_S } = await import('@/components/layout/use-title-marquee');
    expect(planTitleMarquee(120, 160)).toBeNull();
    expect(planTitleMarquee(161, 160)).toBeNull();
    expect(planTitleMarquee(0, 160)).toBeNull();
    const short = planTitleMarquee(200, 160)!;
    const long = planTitleMarquee(400, 160)!;
    expect(short.travel).toBe(200 + TITLE_MARQUEE_GAP_PX);
    // Same pace for any length: every extra pixel of travel costs the same time,
    // and the speed ramps do not stretch with the title.
    expect((long.moveMs - short.moveMs) / (long.travel - short.travel)).toBeCloseTo(1000 / TITLE_MARQUEE_SPEED_PX_PER_S, 0);
    expect(long.rampMs).toBe(short.rampMs);
    expect(long.rampMs).toBeLessThan(800);
    expect(long.totalMs - long.moveMs).toBe(short.totalMs - short.moveMs);
  });
});
