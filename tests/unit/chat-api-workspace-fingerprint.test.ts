import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const loadTaskLedgerSnapshotMock = vi.fn();
const getWorkspaceRootPathByIdMock = vi.fn();

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: (...args: unknown[]) => loadTaskLedgerSnapshotMock(...args),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getWorkspaceRootPathById: (...args: unknown[]) => getWorkspaceRootPathByIdMock(...args),
}));

/**
 * The pre-Gateway budget gate reads persisted usage from `~/.openclaw`
 * transcripts, so an unmocked reader makes this file's result depend on how much
 * the machine has used: past the 1,000,000-token default the send is rejected as
 * `TOKEN_BUDGET_EXCEEDED` and never reaches `rpcParams`. Budget behaviour is
 * covered by `chat-resource-limits-p5-004.test.ts`.
 */
vi.mock('@electron/utils/token-usage', () => ({
  getSessionTokenUsageSummary: vi.fn(async () => ({ totalTokens: 0, estimatedCostUsd: 0 })),
}));

/**
 * D3 closeout: Chat workspaceId → Main normalizeRootPath → Gateway field chain.
 *
 * RED phase: chat-api.ts must forward `workspaceId` (currently dropped at
 * rpcParams) and produce `workspaceFingerprint` from the workspace's rootPath
 * (looked up via workspaces-api) so Gateway receives a trusted authority field
 * instead of relying solely on attempt.ts local effectiveWorkspace.
 */
describe('chat-api workspaceId + workspaceFingerprint forwarding (D3 closeout)', () => {
  beforeEach(() => {
    loadTaskLedgerSnapshotMock.mockReset();
    getWorkspaceRootPathByIdMock.mockReset();
  });

  it('forwards workspaceId to Gateway rpcParams when renderer sends it', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue('C:\\Repos\\App');
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-id' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-app',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-id',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.workspaceId).toBe('ws-app');
  });

  it('produces workspaceFingerprint from workspace rootPath and forwards to Gateway', async () => {
    const rootPath = 'C:\\Repos\\App';
    getWorkspaceRootPathByIdMock.mockResolvedValue(rootPath);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-fp' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-app',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-fp',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.workspaceId).toBe('ws-app');
    // Expected fingerprint: sha256 of lowercased absolute POSIX-style path, first 16 hex chars.
    const absolute = resolve(rootPath);
    const normalized = absolute.replace(/\\/g, '/').toLowerCase();
    const expected = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
    expect(payload.workspaceFingerprint).toBe(expected);
    expect(payload.workspaceFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('omits workspaceFingerprint when workspaceId is absent (no workspace scope)', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue(undefined);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-no-ws' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain chat',
      idempotencyKey: 'idem-no-ws',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('workspaceId');
    expect(payload).not.toHaveProperty('workspaceFingerprint');
  });

  it('forwards workspaceId but omits workspaceFingerprint when rootPath lookup fails', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue(undefined);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-no-root' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-orphan',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-no-root',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    // workspaceId still forwarded so Gateway Task Ledger continuity is preserved.
    expect(payload.workspaceId).toBe('ws-orphan');
    // No fingerprint when rootPath cannot be resolved.
    expect(payload).not.toHaveProperty('workspaceFingerprint');
  });

  it('does not call getWorkspaceRootPathById when workspaceId is absent', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue('C:\\Repos\\App');
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-no-lookup' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain chat',
      idempotencyKey: 'idem-no-lookup',
    });

    expect(getWorkspaceRootPathByIdMock).not.toHaveBeenCalled();
  });
});
