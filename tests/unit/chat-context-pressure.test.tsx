import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatContextPressure, resolveContextPressure } from '../../src/components/chat/ChatContextPressure';
import type { LiveTokenUsage, WorkspaceContextRange } from '../../shared/types/workspace';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'composer.tokenUsageWithLimit') return `${opts?.used} / ${opts?.max} tokens`;
      if (key === 'composer.tokenUsage') return `${opts?.tokens} tokens`;
      if (key === 'composer.contextPressure.unknown') return 'Not measured yet';
      return key;
    },
  }),
}));

const liveUsage = (over: Partial<LiveTokenUsage> = {}): LiveTokenUsage => ({
  sessionKey: 's1',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  totalTokens: 1050,
  updatedAt: 1,
  status: 'final',
  ...over,
});

const contextRange = (over: Partial<WorkspaceContextRange> = {}): WorkspaceContextRange => ({
  sessionKey: 's1',
  status: 'exact',
  ...over,
});

describe('resolveContextPressure', () => {
  it('prefers live usage over the static range', () => {
    const p = resolveContextPressure({
      liveUsage: liveUsage(),
      contextRange: contextRange({ usedTokens: 10, maxTokens: 20 }),
    });
    expect(p.usedTokens).toBe(1050);
  });

  it('falls back to the range when live usage is absent', () => {
    const p = resolveContextPressure({ contextRange: contextRange({ usedTokens: 42, maxTokens: 84 }) });
    expect(p.usedTokens).toBe(42);
    expect(p.maxTokens).toBe(84);
    expect(p.utilisation).toBeCloseTo(0.5, 6);
  });

  it('reports no max when the range has no ceiling', () => {
    const p = resolveContextPressure({ contextRange: contextRange({ usedTokens: 42 }) });
    expect(p.maxTokens).toBeNull();
    expect(p.utilisation).toBeNull();
  });

  it('never divides by a zero ceiling', () => {
    const p = resolveContextPressure({ contextRange: contextRange({ usedTokens: 5, maxTokens: 0 }) });
    expect(p.utilisation).toBeNull();
  });

  it('passes hit rates and cost straight through, independently', () => {
    const p = resolveContextPressure({
      liveUsage: liveUsage({ warmTurnHitRate: 0.82, lastTurnHitRate: 0.4, estimatedCostUsd: 0.0123 }),
    });
    expect(p.warmTurnHitRate).toBe(0.82);
    expect(p.lastTurnHitRate).toBe(0.4);
    expect(p.estimatedCostUsd).toBe(0.0123);
    expect(p.maxTokens).toBeNull();
  });
});

describe('ChatContextPressure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when nothing has been measured yet', () => {
    const { container } = render(<ChatContextPressure />);
    expect(container.firstChild).toBeNull();
  });

  it('shows used/max when both are known', () => {
    render(<ChatContextPressure liveUsage={liveUsage()} contextRange={contextRange({ maxTokens: 8000 })} />);
    expect(screen.getByTestId('chat-context-pressure')).toBeTruthy();
    expect(screen.getByText('1.1k / 8k tokens')).toBeTruthy();
  });

  it('shows used alone when the ceiling is unknown', () => {
    render(<ChatContextPressure liveUsage={liveUsage()} />);
    expect(screen.getByText('1.1k tokens')).toBeTruthy();
  });

  it('renders a row per available metric and skips the rest', () => {
    render(
      <ChatContextPressure
        liveUsage={liveUsage({ warmTurnHitRate: 0.82, lastTurnHitRate: 0.4, estimatedCostUsd: 0.0123 })}
      />,
    );
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('$0.0123')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
  });

  it('omits cache and rate rows when the runtime did not report them', () => {
    render(<ChatContextPressure liveUsage={liveUsage({ cacheReadTokens: 0, warmTurnHitRate: null, lastTurnHitRate: null, estimatedCostUsd: undefined })} />);
    expect(screen.queryByText('composer.contextPressure.warmHitRate')).toBeNull();
    expect(screen.queryByText('composer.contextPressure.estimatedCost')).toBeNull();
  });

  it('exposes an accessible group label', () => {
    render(<ChatContextPressure liveUsage={liveUsage()} />);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('composer.contextPressure.title');
  });
});
