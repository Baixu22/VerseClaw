import { describe, expect, it, vi } from 'vitest';
import {
  normalizeRuntimeApprovalRequested,
  normalizeRuntimeApprovalResolved,
} from '@electron/gateway/event-dispatch';
import {
  createRuntimeApprovalsApi,
  toPendingApprovalEntry,
} from '../../electron/services/runtime-approvals-api';
import {
  decideGatewayRpc,
  isRuntimeApprovalDecisionRpc,
} from '../../electron/services/workspace-permissions';

function createGatewayStub(result: unknown = []) {
  return { rpc: vi.fn(async () => result) } as unknown as Parameters<typeof createRuntimeApprovalsApi>[0];
}

describe('runtime approval frame normalization', () => {
  it('maps a runtime exec.approval.requested frame to the modal shape', () => {
    expect(normalizeRuntimeApprovalRequested({
      id: 'approval-1',
      request: {
        command: 'node --test',
        commandPreview: 'node --test',
        cwd: 'C:/workspace',
        host: 'gateway',
        agentId: 'main',
        sessionKey: 'agent:main:main',
        allowedDecisions: ['allow-once', 'deny', 7],
      },
      createdAtMs: 10,
      expiresAtMs: 20,
    })).toEqual({
      approvalId: 'approval-1',
      command: 'node --test',
      commandPreview: 'node --test',
      cwd: 'C:/workspace',
      host: 'gateway',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      allowedDecisions: ['allow-once', 'deny'],
      createdAtMs: 10,
      expiresAtMs: 20,
    });
  });

  it('falls back to commandPreview when the runtime omits command', () => {
    const requested = normalizeRuntimeApprovalRequested({
      id: 'approval-2',
      request: { commandPreview: 'pnpm test' },
    });
    expect(requested?.command).toBe('pnpm test');
  });

  it('drops frames without an approval id', () => {
    expect(normalizeRuntimeApprovalRequested({ request: { command: 'node --test' } })).toBeNull();
    expect(normalizeRuntimeApprovalRequested('not-a-frame')).toBeNull();
    expect(normalizeRuntimeApprovalResolved({ decision: 'deny' })).toBeNull();
  });

  it('maps exec.approval.resolved', () => {
    expect(normalizeRuntimeApprovalResolved({ id: 'a', decision: 'deny', resolvedBy: 'operator', ts: 5 }))
      .toEqual({ approvalId: 'a', decision: 'deny', resolvedBy: 'operator', ts: 5 });
  });
});

describe('runtimeApprovals host service', () => {
  it('lists pending approvals from exec.approval.list', async () => {
    const gateway = createGatewayStub([
      { id: 'approval-1', request: { command: 'node --test', allowedDecisions: ['allow-once', 'deny'] }, createdAtMs: 1 },
      { request: { command: 'no-id-so-dropped' } },
    ]);
    const api = createRuntimeApprovalsApi(gateway);

    const result = await api.list();

    expect(gateway.rpc).toHaveBeenCalledWith('exec.approval.list', {});
    expect(result.pending).toEqual([
      {
        approvalId: 'approval-1',
        command: 'node --test',
        commandPreview: null,
        cwd: null,
        host: null,
        agentId: null,
        sessionKey: null,
        allowedDecisions: ['allow-once', 'deny'],
        createdAtMs: 1,
        expiresAtMs: undefined,
      },
    ]);
  });

  it('tolerates a non-array list payload', async () => {
    const api = createRuntimeApprovalsApi(createGatewayStub({ unexpected: true }));
    await expect(api.list()).resolves.toEqual({ pending: [] });
  });

  it('forwards exactly one allowed decision to exec.approval.resolve', async () => {
    const gateway = createGatewayStub({ ok: true });
    const api = createRuntimeApprovalsApi(gateway);

    await expect(api.resolve({ approvalId: 'approval-1', decision: 'allow-once' }))
      .resolves.toEqual({ success: true, approvalId: 'approval-1', decision: 'allow-once' });
    expect(gateway.rpc).toHaveBeenCalledWith('exec.approval.resolve', { id: 'approval-1', decision: 'allow-once' });
  });

  it('fails closed without calling the gateway when the id is missing or the decision is unknown', async () => {
    const gateway = createGatewayStub();
    const api = createRuntimeApprovalsApi(gateway);

    await expect(api.resolve({ approvalId: '   ', decision: 'allow-once' }))
      .resolves.toEqual({ success: false, error: 'approvalId is required' });
    await expect(api.resolve({ approvalId: 'approval-1', decision: 'allow-forever' }))
      .resolves.toEqual({ success: false, error: 'Unsupported approval decision: allow-forever' });
    expect(gateway.rpc).not.toHaveBeenCalled();
  });

  it('drops list entries without an approval id', () => {
    expect(toPendingApprovalEntry({ request: { command: 'x' } })).toBeNull();
    expect(toPendingApprovalEntry({ id: 'a' })?.command).toBe('');
  });
});

describe('runtime approval decisions in the workspace permission gate', () => {
  it('identifies only the approval decision method', () => {
    expect(isRuntimeApprovalDecisionRpc('exec.approval.resolve')).toBe(true);
    expect(isRuntimeApprovalDecisionRpc(' exec.approval.resolve ')).toBe(true);
    expect(isRuntimeApprovalDecisionRpc('exec.approval.list')).toBe(false);
    expect(isRuntimeApprovalDecisionRpc('tools.exec')).toBe(false);
  });

  it('lets an operator answer a pending approval in every permission mode', () => {
    for (const mode of ['readOnly', 'plan', 'acceptEdits', 'fullAccess'] as const) {
      expect(decideGatewayRpc('exec.approval.resolve', mode, { id: 'a', decision: 'allow-once' }).allowed).toBe(true);
      expect(decideGatewayRpc('exec.approval.list', mode).allowed).toBe(true);
    }
  });

  it('keeps other mutations blocked in readOnly', () => {
    expect(decideGatewayRpc('config.set', 'readOnly')).toMatchObject({ allowed: false });
    expect(decideGatewayRpc('workspace.create', 'readOnly')).toMatchObject({ allowed: false });
    expect(decideGatewayRpc('tools.exec', 'readOnly', { command: 'node --test' })).toMatchObject({ allowed: false });
  });
});
