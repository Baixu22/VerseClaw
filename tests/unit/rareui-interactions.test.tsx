import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import MarkdownPreview, { markdownOutline } from '@/components/file-preview/MarkdownPreview';
import { DurationPicker } from '@/components/rareui/DurationPicker';
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

  it('sorts actual completed runs newest first and excludes active and failed runs', () => {
    const cards = [
      { runKey: 'old', triggerIndex: 0, status: 'completed', active: false, hasVisibleReply: true, endedAt: 100_000 },
      { runKey: 'running', triggerIndex: 2, status: 'running', active: true, hasVisibleReply: false },
      { runKey: 'failed', triggerIndex: 4, status: 'error', active: false, hasVisibleReply: true },
    ] as UserRunCard[];
    const entries = buildCompletionActivity('current', cards, {
      newest: { runId: 'newest', sessionKey: 'other', status: 'completed', endedAt: 200_000, assistantText: '', thinkingText: '', events: [] },
      active: { runId: 'active', sessionKey: 'other', status: 'running', assistantText: '', thinkingText: '', events: [] },
    }, new Map([[0, 'Visible response']]), [{ index: 1, response: 'Completed reply', completedAt: 150 }, { index: 2, response: 'Still active', completedAt: 300 }], 2);
    expect(entries.map((entry) => entry.id)).toEqual(['other:newest', 'current:message:1', 'current:old']);
    expect(entries[1]).toMatchObject({ index: 1, completedAt: 150_000, preview: 'Completed reply' });
    expect(entries[2].preview).toBe('Visible response');
    expect(buildCompletionActivity('current', [], {}, new Map())).toEqual([]);
  });
});
