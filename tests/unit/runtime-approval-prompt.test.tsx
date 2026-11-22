import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeApprovalPrompt } from '@/components/runtime-approvals/RuntimeApprovalPrompt';
import { ComposerRequestDock } from '@/pages/Chat/ComposerRequestDock';
import { parseToolUiInteraction } from '@/components/tool-ui/agent-interactions';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolve: vi.fn(),
  requested: { current: null as null | ((event: unknown) => void) },
  resolved: { current: null as null | ((event: unknown) => void) },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { runtimeApprovals: { list: mocks.list, resolve: mocks.resolve } },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onRuntimeApprovalRequested: (handler: (event: unknown) => void) => {
      mocks.requested.current = handler;
      return () => {};
    },
    onRuntimeApprovalResolved: (handler: (event: unknown) => void) => {
      mocks.resolved.current = handler;
      return () => {};
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'runtimeApprovals.title': 'Runtime approval required',
      'runtimeApprovals.description': 'The runtime paused before running this command.',
      'runtimeApprovals.commandLabel': 'Command',
      'runtimeApprovals.cwdLabel': 'Working directory',
      'runtimeApprovals.copyCommand': 'Copy command',
      'runtimeApprovals.commandCopied': 'Command copied',
      'runtimeApprovals.unknownCommand': '(the runtime did not report a command)',
      'runtimeApprovals.allowOnce': 'Allow once',
      'runtimeApprovals.allowAlways': 'Always allow',
      'runtimeApprovals.deny': 'Deny',
      'runtimeApprovals.busy': 'Sending decision…',
      'runtimeApprovals.resolveFailed': 'The runtime did not accept this decision.',
    })[key] ?? key,
  }),
}));

const requestedEvent = {
  approvalId: 'approval-1',
  command: 'node --test',
  commandPreview: null,
  cwd: 'C:/workspace',
  host: 'gateway',
  agentId: 'main',
  sessionKey: 'agent:main:main',
  allowedDecisions: ['allow-once', 'deny'],
  createdAtMs: 1,
  expiresAtMs: 2,
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ pending: [] });
  mocks.resolve.mockReset().mockResolvedValue({ success: true, approvalId: 'approval-1', decision: 'allow-once' });
  mocks.requested.current = null;
  mocks.resolved.current = null;
});

describe('RuntimeApprovalPrompt', () => {
  it('prioritizes runtime, then workspace permission, while retaining question selection and the draft', async () => {
    const question = parseToolUiInteraction({ type: 'question-flow', id: 'question-priority',
      steps: [{ id: 'target', title: 'Choose a target', options: [{ id: 'staging', label: 'Staging' }, { id: 'prod', label: 'Production' }] }] })!;
    const approval = { id: 'workspace-priority', workspaceId: 'workspace', sessionKey: 'agent:main:main', source: 'terminal' as const,
      risk: 'dangerous' as const, status: 'pending' as const, requestedAt: 1, command: 'node --test', reason: 'Run verification' };
    const onDecision = vi.fn().mockResolvedValue(undefined);
    const tree = (permission: boolean, questionPending = true) => (
      <RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" requestPending={permission || questionPending}
        requestContent={<ComposerRequestDock approvals={permission ? [approval] : []} interactions={questionPending ? [question] : []}
          canSubmit onDecision={onDecision} onSubmit={vi.fn().mockResolvedValue(undefined)} />}>
        <textarea data-testid="chat-composer-input" aria-label="Draft" defaultValue="Saved draft" />
      </RuntimeApprovalPrompt>
    );
    const view = render(tree(false));
    const input = screen.getByTestId('chat-composer-input');
    const option = screen.getByTestId('chat-tool-ui-question-option-staging');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-pressed', 'true');
    expect(input).not.toBeVisible();
    view.rerender(tree(true));
    expect(option).not.toBeVisible();
    expect(screen.getByTestId('chat-run-pending-approvals')).toBeVisible();
    fireEvent.keyDown(screen.getByTestId('chat-run-pending-approvals').querySelector('[data-slot="approval-card"]')!, { key: 'Escape' });
    expect(onDecision).not.toHaveBeenCalled();
    await act(async () => mocks.requested.current?.(requestedEvent));
    expect(screen.getByTestId('runtime-approval-prompt')).toBeVisible();
    expect(screen.getByTestId('chat-composer-requests')).not.toBeVisible();
    await act(async () => mocks.resolved.current?.({ approvalId: 'approval-1', decision: 'deny' }));
    expect(screen.getByTestId('chat-run-pending-approvals')).toBeVisible();
    view.rerender(tree(false));
    expect(option).toBeVisible();
    expect(option).toHaveAttribute('aria-pressed', 'true');
    view.rerender(tree(false, false));
    expect(input).toBeVisible();
    expect(input).toHaveValue('Saved draft');
  });

  it('replaces only the owning session composer and restores the same draft input', async () => {
    const composer = <textarea aria-label="Draft" defaultValue="Keep this draft" />;
    const { rerender } = render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main">{composer}</RuntimeApprovalPrompt>);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: 'Keep my edited draft and attachment' } });
    await act(async () => {
      mocks.requested.current?.({ ...requestedEvent, approvalId: 'other', sessionKey: 'agent:main:other', command: 'other command' });
    });
    expect(input).toBeVisible();
    expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull();
    await act(async () => { mocks.requested.current?.(requestedEvent); });
    expect(input).not.toBeVisible();
    expect(input.parentElement).toHaveAttribute('inert');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('runtime-approval-command')).toHaveTextContent('node --test');

    rerender(<RuntimeApprovalPrompt sessionKey="agent:main:other" agentId="main">{composer}</RuntimeApprovalPrompt>);
    expect(screen.getByTestId('runtime-approval-command')).toHaveTextContent('other command');
    fireEvent.click(screen.getByTestId('runtime-approval-deny'));
    await waitFor(() => expect(input).toBeVisible());
    expect(mocks.resolve).toHaveBeenCalledWith({ approvalId: 'other', decision: 'deny' });
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect(input).toHaveValue('Keep my edited draft and attachment');

    rerender(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main">{composer}</RuntimeApprovalPrompt>);
    expect(input).not.toBeVisible();
    await act(async () => { mocks.resolved.current?.({ approvalId: 'approval-1', decision: 'deny' }); });
    expect(input).toBeVisible();
    expect(input).toHaveValue('Keep my edited draft and attachment');
  });

  it('does not leak a late rejection or busy state into another session', async () => {
    let finish: (result: unknown) => void = () => {};
    mocks.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.list.mockResolvedValue({ pending: [requestedEvent, { ...requestedEvent, approvalId: 'other', sessionKey: 'agent:main:other' }] });
    const { rerender } = render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    fireEvent.click(await screen.findByTestId('runtime-approval-allow-once'));
    expect(screen.getByTestId('runtime-approval-allow-once')).toBeDisabled();
    rerender(<RuntimeApprovalPrompt sessionKey="agent:main:other" agentId="main" />);
    expect(screen.getByTestId('runtime-approval-allow-once')).toBeEnabled();
    await act(async () => { finish({ success: false, error: 'First request rejected' }); });
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    expect(screen.getByRole('alert')).toHaveTextContent('First request rejected');
    expect(screen.getByTestId('runtime-approval-allow-once')).toBeEnabled();
  });

  it('keeps the composer covered until every pending request for the session resolves', async () => {
    mocks.list.mockResolvedValue({ pending: [requestedEvent, { ...requestedEvent, approvalId: 'next', command: 'next command' }] });
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main"><textarea aria-label="Draft" /></RuntimeApprovalPrompt>);
    await screen.findByTestId('runtime-approval-command');
    fireEvent.click(screen.getByTestId('runtime-approval-deny'));
    await waitFor(() => expect(screen.getByTestId('runtime-approval-command')).toHaveTextContent('next command'));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByTestId('runtime-approval-deny'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible());
    expect(mocks.resolve.mock.calls.map(call => call[0].approvalId)).toEqual(['approval-1', 'next']);
  });

  it('copies through the clipboard fallback and restores the copy button focus', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard API unavailable')) },
    });
    const execCommand = vi.fn(() => {
      const selected = document.activeElement as HTMLTextAreaElement;
      expect(selected.tagName).toBe('TEXTAREA');
      expect(selected.closest('[role="dialog"]')).toBeNull();
      expect(selected.value.slice(selected.selectionStart, selected.selectionEnd)).toBe(requestedEvent.command);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    mocks.list.mockResolvedValue({ pending: [requestedEvent] });
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    const copyButton = await screen.findByRole('button', { name: 'Copy command' });
    copyButton.focus();
    fireEvent.click(copyButton);
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Command copied' })).toHaveFocus());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('copies the original command without deciding or closing the request', async () => {
    const command = '& "C:\\workspace\\my project\\python.exe" -m pytest\n  --capture=no';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.list.mockResolvedValue({ pending: [{ ...requestedEvent, command }] });
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await waitFor(() => expect(screen.getByTestId('runtime-approval-command')).toBeVisible());
    expect(screen.getByTestId('runtime-approval-command').textContent).toBe(command);
    expect(screen.getByRole('heading', { name: 'Runtime approval required' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(screen.getByRole('region', { name: 'Runtime approval required' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));
    expect(screen.getByRole('button', { name: 'Command copied' })).toBeVisible();
    expect(screen.getByTestId('runtime-approval-prompt')).toBeVisible();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('keeps all decision buttons disabled until the offered choice resolves', async () => {
    let finish: (result: unknown) => void = () => {};
    mocks.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const allowedDecisions = ['allow-once', 'allow-always', 'deny'];
    mocks.list.mockResolvedValue({ pending: [{ ...requestedEvent, allowedDecisions }] });
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    const allowAlways = await screen.findByTestId('runtime-approval-allow-always');
    fireEvent.click(allowAlways);
    await waitFor(() => expect(screen.getByText('Sending decision…')).toBeVisible());
    for (const decision of allowedDecisions) expect(screen.getByTestId(`runtime-approval-${decision}`)).toBeDisabled();
    fireEvent.click(screen.getByTestId('runtime-approval-allow-once'));
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith({ approvalId: 'approval-1', decision: 'allow-always' });
    expect(allowedDecisions).toEqual(['allow-once', 'allow-always', 'deny']);
    await act(async () => { finish({ success: true }); });
    await waitFor(() => expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull());
  });

  it('renders nothing while no runtime approval is pending', async () => {
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull();
  });

  it('shows a pending request and sends back exactly the decision the runtime offered', async () => {
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await act(async () => {
      mocks.requested.current?.(requestedEvent);
    });

    expect(screen.getByTestId('runtime-approval-prompt')).toHaveTextContent('node --test');
    expect(screen.getByTestId('runtime-approval-prompt')).toHaveTextContent('C:/workspace');

    fireEvent.click(screen.getByTestId('runtime-approval-allow-once'));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      decision: 'allow-once',
    }));
    await waitFor(() => expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull());
  });

  it('offers only the decisions the runtime listed for that request', async () => {
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await act(async () => {
      mocks.requested.current?.({ ...requestedEvent, allowedDecisions: ['deny'] });
    });

    expect(screen.getByTestId('runtime-approval-deny')).toBeTruthy();
    expect(screen.queryByTestId('runtime-approval-allow-once')).toBeNull();
    expect(screen.queryByTestId('runtime-approval-allow-always')).toBeNull();
  });

  it('keeps the prompt open and surfaces the reason when the runtime rejects the decision', async () => {
    mocks.resolve.mockResolvedValue({ success: false, error: 'Read-only mode does not allow Gateway mutations' });
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await act(async () => {
      mocks.requested.current?.(requestedEvent);
    });

    fireEvent.click(screen.getByTestId('runtime-approval-allow-once'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Read-only mode does not allow Gateway mutations'));
    expect(screen.getByTestId('runtime-approval-prompt')).toBeTruthy();
  });

  it('clears a request when the runtime reports it resolved elsewhere', async () => {
    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);
    await act(async () => {
      mocks.requested.current?.(requestedEvent);
    });
    expect(screen.getByTestId('runtime-approval-prompt')).toBeTruthy();

    await act(async () => {
      mocks.resolved.current?.({ approvalId: 'approval-1', decision: 'deny' });
    });

    await waitFor(() => expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull());
  });

  it('seeds pending requests from the runtime list so a reload does not orphan one', async () => {
    mocks.list.mockResolvedValue({ pending: [{ ...requestedEvent, approvalId: 'approval-seeded' }] });

    render(<RuntimeApprovalPrompt sessionKey="agent:main:main" agentId="main" />);

    await waitFor(() => expect(screen.getByTestId('runtime-approval-prompt')).toBeTruthy());
    fireEvent.click(screen.getByTestId('runtime-approval-deny'));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith({
      approvalId: 'approval-seeded',
      decision: 'deny',
    }));
  });
});

describe('RuntimeApprovalPrompt translations', () => {
  it('every key the prompt renders exists in all shipped locales', async () => {
    const { I18N_RESOURCES } = await import('@shared/i18n/resources');
    const keys = [
      'runtimeApprovals.title',
      'runtimeApprovals.description',
      'runtimeApprovals.commandLabel',
      'runtimeApprovals.cwdLabel',
      'runtimeApprovals.copyCommand',
      'runtimeApprovals.commandCopied',
      'runtimeApprovals.unknownCommand',
      'runtimeApprovals.allowOnce',
      'runtimeApprovals.allowAlways',
      'runtimeApprovals.deny',
      'runtimeApprovals.busy',
      'runtimeApprovals.resolveFailed',
    ];

    for (const [language, namespaces] of Object.entries(I18N_RESOURCES)) {
      const chat = (namespaces as Record<string, Record<string, unknown>>).chat;
      expect(chat, `missing chat namespace for ${language}`).toBeTruthy();
      for (const key of keys) {
        const value = key.split('.').reduce<unknown>(
          (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
          chat,
        );
        expect(typeof value, `${language} is missing ${key}`).toBe('string');
      }
    }
  });
});
