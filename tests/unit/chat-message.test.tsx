import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { RawMessage } from '@/stores/chat';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh' },
  }),
}));

// ChatMessage renders Tooltip for the copy / interrupt affordances (added with
// the Codex-style polish pass), so tests must render inside a TooltipProvider
// the way the real Chat tree does.
function renderMessage(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: vi.fn(),
  statFile: vi.fn(async (path: string) => {
    if (path.includes('missing') || path.includes('不存在')) {
      return { ok: false, error: 'notFound' };
    }
    const isFile = /\.[A-Za-z0-9]+$/.test(path);
    return {
      ok: true,
      isFile,
      isDir: !isFile,
      size: isFile ? 1024 : 0,
    };
  }),
}));

describe('ChatMessage attachment dedupe', () => {
  it('renders assistant text without an avatar or a reserved avatar column', () => {
    renderMessage(
      <ChatMessage
        message={{ id: 'assistant-avatar', role: 'assistant', content: 'Avatar check' }}
      />,
    );

    expect(screen.queryByTestId('chat-assistant-avatar')).not.toBeInTheDocument();
    expect(screen.getByText('Avatar check')).toBeVisible();
  });

  it('keeps attachment-only assistant replies visible even when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [],
      _attachedFiles: [
        {
          fileName: 'artifact.png',
          mimeType: 'image/png',
          fileSize: 0,
          preview: '/tmp/artifact.png',
          filePath: '/tmp/artifact.png',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('artifact.png')).toBeInTheDocument();
  });

  it('keeps image artifacts visible alongside reply text when process attachments are suppressed', () => {
    // Regression for media outgoing being silently dropped when the agent
    // accompanies a `MEDIA:/path.png` artifact with any narration text:
    // process-attachment filtering used to require PDF/XLSX/dir/skill but
    // had no carve-out for images, so the file card never rendered.
    const message: RawMessage = {
      role: 'assistant',
      content: 'Screenshot taken, sending it to you as an attachment.',
      _attachedFiles: [
        {
          fileName: 'desktop_screenshot.png',
          mimeType: 'image/png',
          fileSize: 1234,
          preview: 'data:image/png;base64,abc',
          filePath: '/tmp/desktop_screenshot.png',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('desktop_screenshot.png')).toBeInTheDocument();
  });

  it('shows an explicit loading state for image artifacts before preview hydration finishes', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Image generated.',
      _attachedFiles: [
        {
          fileName: 'generated.png',
          mimeType: 'image/png',
          fileSize: 0,
          preview: null,
          gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/generated/full',
          source: 'gateway-media',
        },
      ],
    };

    renderMessage(<ChatMessage message={message} />);

    expect(screen.getByTestId('image-preview-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('image-preview-unavailable')).not.toBeInTheDocument();
  });

  it('shows an unavailable state after image preview hydration gives up', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Image generated.',
      _attachedFiles: [
        {
          fileName: 'generated.png',
          mimeType: 'image/png',
          fileSize: 0,
          preview: null,
          previewStatus: 'unavailable',
          gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/generated/full',
          source: 'gateway-media',
        },
      ],
    };

    renderMessage(<ChatMessage message={message} />);

    expect(screen.getByTestId('image-preview-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-preview-loading')).not.toBeInTheDocument();
  });

  it('keeps message-ref image artifacts visible alongside reply text when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Compressed, sending it to you:',
      _attachedFiles: [
        {
          fileName: 'desktop_screenshot.jpg',
          mimeType: 'image/jpeg',
          fileSize: 837_000,
          preview: 'data:image/jpeg;base64,xyz',
          filePath: '/tmp/desktop_screenshot.jpg',
          source: 'message-ref',
        },
      ],
    };

    renderMessage(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('desktop_screenshot.jpg')).toBeInTheDocument();
  });

  it('keeps html artifacts visible when process attachments are suppressed', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '已生成 /workspace/demo.html',
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('demo.html')).toBeInTheDocument();
  });

  it('hides generic tool-result markdown attachments when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Coder has finished the analysis, here are the conclusions.',
      _attachedFiles: [
        {
          fileName: 'CHECKLIST.md',
          mimeType: 'text/markdown',
          fileSize: 433,
          preview: null,
          filePath: '/Users/bytedance/.openclaw/workspace/CHECKLIST.md',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(screen.getByText('Coder has finished the analysis, here are the conclusions.')).toBeInTheDocument();
    expect(screen.queryByText('CHECKLIST.md')).not.toBeInTheDocument();
  });

  it('keeps attached SKILL.md visible when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '这是文件。',
      _attachedFiles: [
        {
          fileName: 'SKILL.md',
          mimeType: 'text/markdown',
          fileSize: 128,
          preview: null,
          filePath: '/workspace/skills/open-xueqiu/SKILL.md',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(screen.getByText('SKILL.md')).toBeInTheDocument();
  });

  it('keeps pdf and spreadsheet artifacts visible when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Here are the generated files.',
      _attachedFiles: [
        {
          fileName: 'sales.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 1024,
          preview: null,
          filePath: '/tmp/sales.xlsx',
          source: 'message-ref',
        },
        {
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
          preview: null,
          filePath: '/tmp/report.pdf',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByText('sales.xlsx')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('derives preview cards from assistant text paths when attachments are missing', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '已生成测试 PDF 文件： 测试PDF文件.pdf 位置： `/Users/zhonghaolu/.openclaw/workspace/测试PDF文件.pdf`',
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('测试PDF文件.pdf')).toBeInTheDocument();
  });

  it('derives skill directory cards from assistant text paths', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '名称： open-eastmoney\n位置： ~/.openclaw/skills/open-eastmoney\n校验结果：通过',
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('open-eastmoney')).toBeInTheDocument();
    expect(screen.getByText('文件夹')).toBeInTheDocument();
  });

  it('keeps unicode Windows skill directory paths as cards', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: String.raw`位置： C:\Users\张三\.openclaw\skills\打开东方财富`,
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('打开东方财富')).toBeInTheDocument();
    expect(screen.getByText('文件夹')).toBeInTheDocument();
  });

  it('shows SKILL.md as a previewable file card instead of a folder', async () => {
    const onOpenFile = vi.fn();
    const message: RawMessage = {
      role: 'assistant',
      content: '位置： ~/.openclaw/skills/open-baidu\nMarkdown 文件： ~/.openclaw/skills/open-baidu/SKILL.md',
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments onOpenFile={onOpenFile} />);

    expect(await screen.findByText('open-baidu')).toBeInTheDocument();
    expect(await screen.findByText('SKILL.md')).toBeInTheDocument();
    expect(screen.getAllByText('文件夹')).toHaveLength(1);

    fireEvent.click(screen.getByText('SKILL.md'));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'SKILL.md',
      filePath: '~/.openclaw/skills/open-baidu/SKILL.md',
      mimeType: 'text/markdown',
    }));
  });

  it('does not show cards for hallucinated missing paths', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '不存在的文件： ~/.openclaw/skills/missing-skill/SKILL.md',
    };

    renderMessage(<ChatMessage message={message} suppressProcessAttachments />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument();
  });

  it('continues hiding non-preview process attachments when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'I also used a temporary file.',
      _attachedFiles: [
        {
          fileName: 'debug.log',
          mimeType: 'text/plain',
          fileSize: 1024,
          preview: null,
          filePath: '/tmp/debug.log',
          source: 'message-ref',
        },
      ],
    };

    renderMessage(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.queryByText('debug.log')).not.toBeInTheDocument();
  });
});

describe('ChatMessage range readiness', () => {
  it('keeps its boundary action disabled until the owner scope is ready', () => {
    const onCompactRange = vi.fn();
    const message: RawMessage = { role: 'user', id: 'provider-id', __openclaw: { id: 'owner-leaf' }, content: 'Keep this boundary.' };
    const view = renderMessage(<ChatMessage message={message} onCompactRange={onCompactRange} compactDisabledReason="Session generation is still loading" />);
    const action = screen.getByTestId('chat-user-message-summarize-from');
    expect(action).toBeDisabled(); expect(action).toHaveAttribute('title', 'Session generation is still loading');
    fireEvent.click(action); expect(onCompactRange).not.toHaveBeenCalled();
    view.rerender(<TooltipProvider><ChatMessage message={message} onCompactRange={onCompactRange} /></TooltipProvider>);
    fireEvent.click(screen.getByTestId('chat-user-message-summarize-from'));
    expect(onCompactRange).toHaveBeenCalledWith('owner-leaf', 'from');
  });
});

describe('ChatMessage LaTeX rendering', () => {
  it('renders inline `$...$` math with KaTeX', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Mass-energy equivalence: $E=mc^2$ is famous.',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders display `$$...$$` math as a block', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Definite integral:\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('renders `\\(...\\)` inline math (OpenAI-style escaping)', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Quadratic formula: \\(x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\).',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders `\\[...\\]` block math (OpenAI-style escaping)', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Sum formula:\n\n\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not rewrite `\\(` inside code fences', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Code sample:\n\n```\nprintf("\\(hello\\)")\n```\n',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    expect(container.textContent).toContain('\\(hello\\)');
    expect(container.querySelector('.katex')).toBeNull();
  });
});

describe('ChatMessage word wrapping', () => {
  // Regression for #931: word-break:break-all on the message bubble wrappers
  // forced English words to split mid-character. Long unbreakable tokens
  // (URLs, identifiers) still wrap via overflow-wrap:break-word; inline
  // <code> and <a> children keep break-all because those carry non-prose
  // tokens where mid-char breaks are still desirable.
  it('does not apply break-all to the assistant prose wrapper', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'The neural network response should wrap at word boundaries.',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    const prose = container.querySelector('.prose');
    expect(prose).not.toBeNull();
    expect(prose?.classList.contains('break-all')).toBe(false);
    expect(prose?.classList.contains('break-words')).toBe(true);
  });

  it('does not apply break-all to user message text', () => {
    const message: RawMessage = {
      role: 'user',
      content: 'A user-typed sentence that should also wrap by words, not characters.',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    const paragraph = container.querySelector('p.whitespace-pre-wrap');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.classList.contains('break-all')).toBe(false);
    expect(paragraph?.classList.contains('break-words')).toBe(true);
  });

  // Inline code no longer carries break utilities as classes. The Codex recipe
  // (_inlineMarkdown_l45ev_793, ported to `.codex-markdown :not(pre) > code` in
  // styles/codex-conversation.css) sets `overflow-wrap: anywhere` +
  // `word-break: break-word`, which still breaks long identifiers mid-token but
  // is stylesheet-driven, so jsdom can't observe it as a class. What this test
  // guards now is that the element is left to the port — no competing border or
  // background utility is reintroduced on it.
  it('leaves inline code styling to the ported Codex recipe', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Use `someVeryLongIdentifierNameThatShouldStillBreakAnywhere` here.',
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    const inlineCode = container.querySelector('.prose code');
    expect(inlineCode).not.toBeNull();
    expect(inlineCode?.closest('.codex-markdown')).not.toBeNull();
    const classes = Array.from(inlineCode?.classList ?? []);
    expect(classes.some((name) => name.startsWith('border'))).toBe(false);
    expect(classes.some((name) => name.startsWith('bg-'))).toBe(false);
  });

  // Regression: fenced code blocks used to set only `overflow-x-auto`, which
  // hid long log lines / paths behind a horizontal scroll that the chat
  // viewport often clipped. Long lines must now wrap inside the bubble.
  it('wraps fenced code block contents instead of overflowing horizontally', () => {
    const longLine = 'config change requires channel reload (wecom) — deferring until 2 operation(s), 1 reply(ies), 1 embedded run(s) complete';
    const message: RawMessage = {
      role: 'assistant',
      content: ['Gateway log:', '', '```', longLine, '```'].join('\n'),
    };
    const { container } = renderMessage(<ChatMessage message={message} />);
    const codeBlock = container.querySelector('.prose pre');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(codeBlock?.classList.contains('break-words')).toBe(true);
  });
});

describe('ChatMessage reply styling', () => {
  it('renders assistant replies as plain Markdown without a rounded bubble wrapper', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Direct Markdown reply with **bold** text.',
    };

    const { container } = renderMessage(<ChatMessage message={message} />);
    const prose = container.querySelector('.prose');
    expect(prose).not.toBeNull();
    expect(prose?.classList.contains('rounded-2xl')).toBe(false);
    expect(prose?.classList.contains('bg-black/5')).toBe(false);
    expect(prose?.classList.contains('dark:bg-white/5')).toBe(false);
    expect(prose?.parentElement?.classList.contains('rounded-2xl')).toBe(false);
  });

  it('keeps user messages in the blue rounded bubble', () => {
    const message: RawMessage = {
      role: 'user',
      content: 'Keep the prompt bubble.',
    };

    const { container } = renderMessage(<ChatMessage message={message} />);
    const bubble = container.querySelector('[data-testid="chat-user-message-bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble?.classList.contains('rounded-2xl')).toBe(true);
    expect(bubble).toHaveTextContent('Keep the prompt bubble.');
  });
});

describe('ChatMessage image copy', () => {
  beforeEach(() => {
    class MockClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    Object.assign(globalThis, { ClipboardItem: MockClipboardItem });
    Object.assign(navigator, {
      clipboard: {
        write: vi.fn(async () => undefined),
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  it('copies image bytes instead of the media URL text when an image attachment is present', async () => {
    const { readBinaryFile } = await import('@/lib/file-preview-client');
    vi.mocked(readBinaryFile).mockResolvedValueOnce({
      ok: true,
      data: Uint8Array.from([137, 80, 78, 71]),
      mimeType: 'image/png',
    });

    const message: RawMessage = {
      role: 'assistant',
      content: 'http://127.0.0.1:18789/api/chat/media/outgoing/agent/main/full',
      _attachedFiles: [
        {
          fileName: 'cat.png',
          mimeType: 'image/png',
          fileSize: 1234,
          preview: null,
          filePath: '/tmp/cat.png',
          source: 'tool-result',
        },
      ],
    };

    renderMessage(<ChatMessage message={message} />);

    // The lone URL paragraph is itself a link card, with its own buttons.
    fireEvent.click(screen.getByTestId('chat-assistant-message-copy'));
    await vi.waitFor(() => {
      expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('keeps response actions compact and quotes or forks through existing callbacks', async () => {
    const onQuoteResponse = vi.fn();
    const onForkFromMessage = vi.fn();
    renderMessage(
      <ChatMessage
        message={{ id: 'assistant-actions', role: 'assistant', content: 'A concise answer.' }}
        onQuoteResponse={onQuoteResponse}
        onForkFromMessage={onForkFromMessage}
        canForkFromMessage
      />,
    );

    const actionBar = screen.getByTestId('chat-assistant-message-actions');
    expect(actionBar).toHaveClass('w-fit', 'justify-start');
    expect(actionBar).not.toHaveClass('w-full');
    expect(actionBar).toHaveClass('[@media(hover:none)]:!opacity-100', 'motion-reduce:transition-none');
    expect(screen.getByTestId('chat-assistant-message-copy')).toBeVisible();
    expect(screen.getByTestId('chat-assistant-message-fork')).toBeVisible();
    expect(screen.getByTestId('chat-assistant-message-quote')).toBeVisible();
    expect(screen.getByTestId('chat-assistant-message-quote')).toHaveAttribute('aria-label', expect.stringMatching(/\S/));
    expect(screen.getByTestId('chat-assistant-message-fork')).toHaveAttribute('aria-label', expect.stringMatching(/\S/));

    fireEvent.click(screen.getByTestId('chat-assistant-message-quote'));
    expect(onQuoteResponse).toHaveBeenCalledWith('A concise answer.');
    fireEvent.click(screen.getByTestId('chat-assistant-message-fork'));
    expect(onForkFromMessage).toHaveBeenCalledWith('assistant-actions');
    fireEvent.click(screen.getByTestId('chat-assistant-message-copy'));
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('A concise answer.');
    });
  });
});

describe('ChatMessage Tool UI rendering', () => {
  it('renders fenced Tool UI plan payloads on demand and removes the raw JSON block', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        'Here is the plan:',
        '',
        '```tool-ui',
        JSON.stringify({
          type: 'plan',
          id: 'plan-demo',
          title: 'Implementation plan',
          todos: [
            { id: 'read', label: 'Read the current renderer', status: 'completed' },
            { id: 'wire', label: 'Wire the interaction card', status: 'in_progress' },
          ],
        }),
        '```',
        '',
        'Review the steps before continuing.',
      ].join('\n'),
    };

    const { container } = renderMessage(<ChatMessage message={message} />);

    expect(screen.queryByTestId('chat-tool-ui-plan')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-tool-process-details').querySelector('summary')!);
    expect(await screen.findByTestId('chat-tool-ui-plan')).toBeVisible();
    expect(screen.getByText('Implementation plan')).toBeInTheDocument();
    expect(screen.getByText('Read the current renderer')).toBeInTheDocument();
    expect(screen.getByText('Review the steps before continuing.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('"todos"');
  });

  it('renders Tool UI option-list tool calls and emits a structured response', () => {
    const onSubmit = vi.fn();
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'choice-1',
          name: 'option_list',
          input: {
            title: 'Pick a route',
            options: [
              { id: 'fast', label: 'Fast path' },
              { id: 'careful', label: 'Careful path' },
            ],
            selectionMode: 'single',
          },
        },
      ],
    } as RawMessage;

    renderMessage(
      <ChatMessage
        message={message}
        onSubmitInteractionResponse={onSubmit}
        canSubmitInteractionResponse
      />,
    );

    fireEvent.click(screen.getByText('Careful path'));
    fireEvent.click(screen.getByRole('button', { name: /Send response|toolUi\.actions\.sendResponse/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toContain('"type": "option-list"');
    expect(onSubmit.mock.calls[0][0]).toContain('"careful"');
  });

  it('parses relaxed Tool UI wrapper arrays from component-specific fences', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        'Structured payload follows:',
        '',
        '```tool-ui plan',
        '[',
        "  { component: 'plan', props: {",
        "    title: 'Relaxed rollout',",
        '    todos: [',
        "      { label: 'Accept single quotes', status: 'completed', },",
        "      { label: 'Strip trailing commas', status: 'pending', },",
        '    ],',
        '  }, },',
        "  { tool: 'option_list', args: {",
        "    title: 'Fallback choice',",
        "    selectionMode: 'single',",
        "    options: ['Keep Markdown', 'Render card'],",
        '  }, },',
        ']',
        '```',
      ].join('\n'),
    };

    const { container } = renderMessage(<ChatMessage message={message} />);

    expect(screen.getByTestId('chat-tool-ui-option-list')).toHaveTextContent('Fallback choice');
    fireEvent.click(screen.getByTestId('chat-tool-process-details').querySelector('summary')!);
    expect(await screen.findByTestId('chat-tool-ui-plan')).toHaveTextContent('Relaxed rollout');
    expect(screen.getByText('Render card')).toBeInTheDocument();
    expect(container).not.toHaveTextContent("component: 'plan'");
  });

  it('converts Markdown plan checklists into plan cards', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        'Before touching code:',
        '',
        '## Plan',
        'Stage the renderer changes carefully.',
        '- [x] Read the current renderer',
        '- [~] Adapt the Tool UI parser',
        '- [ ] Add parser coverage',
        '',
        'Then verify the UI.',
      ].join('\n'),
    };

    const { container } = renderMessage(<ChatMessage message={message} />);

    fireEvent.click(screen.getByTestId('chat-tool-process-details').querySelector('summary')!);
    expect(await screen.findByTestId('chat-tool-ui-plan')).toHaveTextContent('Plan');
    expect(screen.getByText('Adapt the Tool UI parser')).toBeInTheDocument();
    expect(screen.getByText('Before touching code:')).toBeInTheDocument();
    expect(screen.getByText('Then verify the UI.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('- [x]');
  });

  it('converts Markdown question and options blocks into question flow cards', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        'Question: Which format should Verse Claw use when the model pauses?',
        'Options:',
        '1. Structured cards -- Best for guided rendering',
        '2. Plain markdown -- Backup only',
      ].join('\n'),
    };

    renderMessage(<ChatMessage message={message} />);

    expect(screen.getByTestId('chat-tool-ui-question-flow')).toHaveTextContent('Which format should Verse Claw use when the model pauses?');
    expect(screen.getByText('Structured cards')).toBeInTheDocument();
    expect(screen.getByText('Backup only')).toBeInTheDocument();
  });

  it('converts Markdown preferences tables into preferences panel cards', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        '## Preferences',
        '| Setting | Type | Default | Options |',
        '| --- | --- | --- | --- |',
        '| Rich cards | switch | on | |',
        '| Density | toggle | compact | compact / comfortable |',
      ].join('\n'),
    };

    renderMessage(<ChatMessage message={message} />);

    expect(screen.getByTestId('chat-tool-ui-preferences-panel')).toHaveTextContent('Preferences');
    expect(screen.getByText('Rich cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'compact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'comfortable' })).toBeInTheDocument();
  });

  it('keeps ordinary JSON code fences visible when they are not Tool UI payloads', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [
        'Debug data:',
        '',
        '```json',
        '{ "todos": [] }',
        '```',
      ].join('\n'),
    };

    const { container } = renderMessage(<ChatMessage message={message} />);

    expect(screen.queryByTestId('chat-tool-ui-plan')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('"todos"');
  });
});

describe('ChatMessage Fork action identity and availability', () => {
  it('keeps a missing boundary visible and disabled, and never bypasses busy message actions', () => {
    const onFork = vi.fn();
    const missing: RawMessage = { role: 'user', id: 'provider-message-id', __openclaw: {}, content: 'A question with no owner boundary.' };
    const view = renderMessage(<ChatMessage message={missing} onForkFromMessage={onFork} />);
    const action = () => view.getByTestId('chat-user-message-fork');
    expect(action()).toBeDisabled();
    const missingReason = action().getAttribute('aria-description');
    expect(missingReason).toBeTruthy();
    fireEvent.click(action());
    expect(onFork).not.toHaveBeenCalled();
    const anchored: RawMessage = { ...missing, __openclaw: { id: 'owner-entry-id' } };
    for (const busy of [
      { canResendUserMessage: false, isStreaming: false },
      { canResendUserMessage: true, isStreaming: true },
    ]) {
      view.rerender(<TooltipProvider><ChatMessage message={anchored} onForkFromMessage={onFork} {...busy} /></TooltipProvider>);
      expect(action()).toBeDisabled();
      expect(action().getAttribute('aria-description')).toBeTruthy();
      expect(action().getAttribute('aria-description')).not.toBe(missingReason);
      fireEvent.click(action());
      expect(onFork).not.toHaveBeenCalled();
    }
    view.rerender(<TooltipProvider><ChatMessage message={anchored} onForkFromMessage={onFork}
      canResendUserMessage isStreaming={false} /></TooltipProvider>);
    expect(action()).toBeEnabled();
    fireEvent.click(action());
    expect(onFork).toHaveBeenCalledExactlyOnceWith('owner-entry-id');
    view.rerender(<TooltipProvider><ChatMessage message={{ role: 'user', content: 'No identity at all' }}
      onForkFromMessage={onFork} /></TooltipProvider>);
    expect(action()).toBeDisabled();
    fireEvent.click(action());
    expect(onFork).toHaveBeenCalledTimes(1);
    view.rerender(<TooltipProvider><ChatMessage message={anchored} /></TooltipProvider>);
    expect(view.queryByTestId('chat-user-message-fork')).toBeNull();
  });
});
