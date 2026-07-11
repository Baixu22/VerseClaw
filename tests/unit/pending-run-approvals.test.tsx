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
