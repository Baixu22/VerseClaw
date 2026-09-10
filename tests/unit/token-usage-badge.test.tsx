import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TokenUsageBadge } from '@/components/assistant-render/TokenUsageBadge';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('TokenUsageBadge', () => {
  it('keeps only the total visible and reveals the breakdown on demand', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <TokenUsageBadge
          message={{
            role: 'assistant',
            content: 'Done.',
            metadata: {
              usage: {
                inputTokens: 1200,
                outputTokens: 300,
                cacheReadTokens: 500,
                totalTokens: 2000,
                estimatedCostUsd: 0.0123,
              },
            },
          } as never}
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByTestId('token-usage-badge');
    expect(trigger).toHaveTextContent('2K');
    expect(screen.queryByText('Input tokens')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    expect((await screen.findAllByText('Input tokens')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('300').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0123').length).toBeGreaterThan(0);
  });

  it('renders nothing when usage is unavailable', () => {
    render(
      <TooltipProvider>
        <TokenUsageBadge message={{ role: 'assistant', content: 'Old message.' }} />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('token-usage-badge')).not.toBeInTheDocument();
  });
});
