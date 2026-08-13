import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PendingRunApprovals } from '@/components/tool-ui/PendingRunApprovals';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'toolUi.approval.host.title': 'Permission required',
      'toolUi.approval.host.approve': 'Approve',
      'toolUi.approval.host.deny': 'Deny',
      'toolUi.approval.host.retryRequired': 'Approval recorded. Retry is required.',
      'approvals.source.terminal': 'Terminal',
      'approvals.risk.dangerous': 'High risk',
    })[key] ?? key,
  }),
}));

const pendingApproval: PermissionApprovalEvent = {
  id: 'approval-1',
  workspaceId: 'workspace-1',
  sessionKey: 'agent:main:main',
  runId: 'run-1',
  mode: 'accept-edits',
  source: 'terminal',
  requestedAt: 1,
  status: 'pending',
  risk: 'dangerous',
  command: 'git clean -fd',
  cwd: 'C:/repo',
  reason: 'Remove untracked files',
};

describe('PendingRunApprovals', () => {
  it('uses the injected host decision callback and prevents duplicate decisions', async () => {
    let resolveDecision: (() => void) | undefined;
    const onDecision = vi.fn(() => new Promise<void>((resolve) => {
      resolveDecision = resolve;
    }));

    render(<PendingRunApprovals approvals={[pendingApproval]} onDecision={onDecision} />);

    expect(screen.getByTestId('chat-run-pending-approvals')).toHaveTextContent('git clean -fd');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('approval-1', 'approved');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();

    resolveDecision?.();
    await waitFor(() => expect(screen.getByText('Approval recorded. Retry is required.')).toBeVisible());
  });

  it('routes denial through the same host-only callback', async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    render(<PendingRunApprovals approvals={[pendingApproval]} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(onDecision).toHaveBeenCalledWith('approval-1', 'denied'));
  });
});

describe('PendingRunApprovals translations', () => {
  it('every key the card renders exists in all shipped locales', async () => {
    // The component shipped for months with four keys that existed in no
    // language pack; the mock above hid it. Assert against the real bundles.
    const { I18N_RESOURCES } = await import('@shared/i18n/resources');
    const keys = [
      'toolUi.approval.host.title',
      'toolUi.approval.host.approve',
      'toolUi.approval.host.deny',
      'toolUi.approval.host.retryRequired',
      'approvals.source.terminal',
      'approvals.source.gateway',
      'approvals.source.mcp',
      'approvals.source.file',
      'approvals.source.git',
      'approvals.source.cleaner',
      'approvals.source.remoteControl',
      'approvals.risk.write',
      'approvals.risk.network',
      'approvals.risk.destructive',
      'approvals.risk.external-write',
      'approvals.risk.dangerous',
    ];
    const read = (bundle: unknown, path: string): unknown => path
      .split('.')
      .reduce<unknown>((node, part) => (
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
      ), bundle);

    for (const [language, namespaces] of Object.entries(I18N_RESOURCES)) {
      const chat = (namespaces as Record<string, unknown>).chat;
      for (const key of keys) {
        expect(read(chat, key), `${language}:${key}`).toBeTypeOf('string');
      }
    }
  });
});
