import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentInteractionRenderer, parseToolUiInteraction } from '@/components/tool-ui/agent-interactions';
import { projectMessageRender } from '@/pages/Chat/message-render-projection';
import type { RawMessage } from '@/stores/chat';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; query?: string }) => {
      if (key === 'toolUi.webSearch.searchingQuery') return 'Searching "' + (options?.query ?? '') + '"';
      if (key === 'toolUi.webSearch.searched') return 'Searched ' + (options?.count ?? 0) + ' sites';
      if (key === 'toolUi.webSearch.more_one') return 'more source';
      if (key === 'toolUi.webSearch.more_other') return 'more sources';
      return key;
    },
  }),
}));

afterEach(cleanup);

describe('Rare UI Web Search adaptation', () => {
  it('renders source cards with a left-to-right progress wash instead of the reference ring', () => {
    const interaction = parseToolUiInteraction({
      type: 'web-search',
      id: 'search-1',
      query: 'react bits call chip',
      provider: 'tavily',
      status: 'searching',
      progress: 0.42,
      results: [
        { title: 'React Bits', url: 'https://www.reactbits.dev/micro/call-chip', content: 'Call chip docs' },
        { title: 'Rare UI', url: 'https://rareui.com/components/websearch', content: 'Search docs' },
      ],
    });
    expect(interaction?.type).toBe('web-search');

    render(
      <AgentInteractionRenderer interactions={interaction ? [interaction] : []} />,
    );

    expect(screen.getByTestId('chat-tool-ui-web-search')).toBeVisible();
    const progress = screen.getByTestId('chat-web-search-progress');
    expect(progress).toHaveAttribute('data-progress-mode', 'horizontal');
    expect(progress.className).toContain('origin-left');
    const bar = screen.getByTestId('chat-web-search-bar');
    expect(bar).toHaveAttribute('data-progress-mode', 'horizontal');
    expect(bar.className).toContain('origin-left');
    // The reference ring is replaced, not layered underneath.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.queryByTestId('markdown-progress-ring')).toBeNull();
    expect(screen.getByTestId('chat-web-search-stack')).toBeVisible();
    expect(screen.getAllByTestId('chat-web-search-source')).toHaveLength(2);
    expect(screen.getByText('reactbits')).toBeVisible();
  });

  it('promotes a runtime web_search tool result into the web-search interaction', () => {
    const message = {
      role: 'assistant',
      id: 'message-1',
      content: [
        { type: 'tool_use', id: 'call-1', name: 'web_search', input: { query: 'react bits call chip' } },
      ],
      _toolResults: [
        {
          toolCallId: 'call-1',
          toolName: 'web_search',
          result: JSON.stringify({
            query: 'react bits call chip',
            provider: 'tavily',
            results: [
              {
                title: 'React Bits CallChip',
                url: 'https://www.reactbits.dev/micro/call-chip',
                snippet: 'A call chip with a left-to-right progress wash.',
                score: 0.9,
              },
            ],
          }),
        },
      ],
    } as unknown as RawMessage;

    const projection = projectMessageRender(message, {
      isUser: false,
      suppressAssistantText: false,
      suppressToolCards: false,
    });
    const webSearch = projection.toolUiInteractions.find((entry) => entry.type === 'web-search');
    expect(webSearch).toMatchObject({
      type: 'web-search',
      query: 'react bits call chip',
      provider: 'tavily',
      status: 'done',
    });
    if (webSearch?.type !== 'web-search') throw new Error('expected a web-search interaction');
    expect(webSearch.sources).toEqual([
      expect.objectContaining({
        title: 'React Bits CallChip',
        url: 'https://www.reactbits.dev/micro/call-chip',
        snippet: 'A call chip with a left-to-right progress wash.',
      }),
    ]);
  });

  it('does not fabricate a web-search card for an unrelated tool result', () => {
    const message = {
      role: 'assistant',
      id: 'message-2',
      content: [{ type: 'tool_use', id: 'call-2', name: 'exec', input: { cmd: 'ls' } }],
      _toolResults: [
        { toolCallId: 'call-2', toolName: 'exec', result: JSON.stringify({ results: [{ title: 'unrelated', url: 'https://example.com' }] }) },
      ],
    } as unknown as RawMessage;

    const projection = projectMessageRender(message, {
      isUser: false,
      suppressAssistantText: false,
      suppressToolCards: false,
    });
    expect(projection.toolUiInteractions.some((entry) => entry.type === 'web-search')).toBe(false);
  });
});
