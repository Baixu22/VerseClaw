import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeApprovalPrompt } from '@/components/runtime-approvals/RuntimeApprovalPrompt';

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
  it('renders nothing while no runtime approval is pending', async () => {
    render(<RuntimeApprovalPrompt />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('runtime-approval-prompt')).toBeNull();
  });

  it('shows a pending request and sends back exactly the decision the runtime offered', async () => {
    render(<RuntimeApprovalPrompt />);
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
    render(<RuntimeApprovalPrompt />);
    await act(async () => {
      mocks.requested.current?.({ ...requestedEvent, allowedDecisions: ['deny'] });
    });

    expect(screen.getByTestId('runtime-approval-deny')).toBeTruthy();
    expect(screen.queryByTestId('runtime-approval-allow-once')).toBeNull();
    expect(screen.queryByTestId('runtime-approval-allow-always')).toBeNull();
  });

  it('keeps the prompt open and surfaces the reason when the runtime rejects the decision', async () => {
    mocks.resolve.mockResolvedValue({ success: false, error: 'Read-only mode does not allow Gateway mutations' });
    render(<RuntimeApprovalPrompt />);
    await act(async () => {
      mocks.requested.current?.(requestedEvent);
    });

    fireEvent.click(screen.getByTestId('runtime-approval-allow-once'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Read-only mode does not allow Gateway mutations'));
    expect(screen.getByTestId('runtime-approval-prompt')).toBeTruthy();
  });

  it('clears a request when the runtime reports it resolved elsewhere', async () => {
    render(<RuntimeApprovalPrompt />);
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

    render(<RuntimeApprovalPrompt />);

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
